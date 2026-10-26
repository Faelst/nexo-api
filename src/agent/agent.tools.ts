import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { Priority, Prisma } from '@prisma/client'
import { z } from 'zod'
import type { DraftField, DraftPart } from '../conversations/message-parts'
import type { PrismaService } from '../prisma/prisma.service'
import type { KnowledgeService } from '../knowledge/knowledge.service'
import { AFFECTED_LABEL, CATEGORY_LABEL, PRIORITY_LABEL, TYPE_LABEL } from '../service-desk/labels'
import { priorityFor, URGENCY_LABEL } from '../service-desk/priority'
import { computeDueAt, formatBrt } from '../service-desk/sla'
import { LegacyUnavailableError, withLegacyRetry } from '../tickets/legacy-system'
import type { Tone } from '../tickets/ticket.mapper'
import type { TicketsService } from '../tickets/tickets.service'
import { createTool } from './mastra'
import type { TurnContext } from './turn-context'

export type ToolDeps = {
  prisma: PrismaService
  tickets: TicketsService
  knowledge: KnowledgeService
}

const PRIORITY_TONE: Record<Priority, Tone> = { CRITICA: 'danger', ALTA: 'warning', MEDIA: 'neutral', BAIXA: 'neutral' }

const ticketNumber = z
  .string()
  .regex(/^(INC|REQ)-\d+$/i, 'Use o formato INC-12345 ou REQ-12345')
  .transform((v) => v.toUpperCase())

/** Resume o resultado de uma ferramenta para o log de transparência. */
function summarize(output: unknown): string {
  if (output && typeof output === 'object' && 'erro' in output) return `erro: ${String(output.erro)}`
  if (Array.isArray(output)) return `${output.length} resultado(s)`
  const text = JSON.stringify(output)
  return text.length > 160 ? `${text.slice(0, 157)}…` : text
}

/**
 * Executa uma ferramenta registrando o passo visível, a duração e o resultado.
 * Erros conhecidos viram respostas estruturadas para o modelo decidir como seguir.
 */
async function instrumented<T>(
  ctx: TurnContext,
  meta: { tool: string; label?: string },
  input: unknown,
  fn: () => Promise<T>,
): Promise<T | { erro: string; mensagem: string }> {
  const started = Date.now()
  if (meta.label) ctx.addStep(meta.label)
  let output: T | { erro: string; mensagem: string }
  let ok = true
  try {
    output = await fn()
  } catch (error) {
    ok = false
    if (error instanceof LegacyUnavailableError) {
      output = {
        erro: 'sistema_de_chamados_indisponivel',
        mensagem: 'O sistema de chamados não respondeu após 3 tentativas.',
      }
    } else if (error instanceof NotFoundException || error instanceof BadRequestException) {
      output = { erro: 'invalido', mensagem: error.message }
    } else {
      throw error
    }
  }
  ctx.toolCalls.push({
    tool: meta.tool,
    label: meta.label ?? meta.tool,
    input,
    ok,
    durationMs: Date.now() - started,
    summary: summarize(output),
  })
  return output
}

async function createDraft(
  deps: ToolDeps,
  ctx: TurnContext,
  kind: 'CREATE' | 'UPDATE',
  payload: Prisma.InputJsonObject,
  view: { title: string; description: string; fields: DraftField[]; ticketNumber?: string; ticketId?: string },
): Promise<DraftPart> {
  // Só um rascunho pendente por conversa: o novo substitui o anterior
  const pending = await deps.prisma.ticketDraft.findMany({
    where: { conversationId: ctx.conversation.id, status: 'PENDING' },
    select: { id: true, messageId: true },
  })
  if (pending.length) {
    await deps.prisma.ticketDraft.updateMany({
      where: { id: { in: pending.map((d) => d.id) } },
      data: { status: 'CANCELED', resolvedAt: new Date() },
    })
    ctx.supersededDrafts.push(...pending)
  }

  const code = `D-${Date.now().toString(36).slice(-5).toUpperCase()}`
  const draft = await deps.prisma.ticketDraft.create({
    data: { code, kind, payload, conversationId: ctx.conversation.id, ticketId: view.ticketId },
  })
  ctx.draftIds.push(draft.id)
  return {
    type: 'draft',
    draftId: draft.id,
    code,
    kind,
    status: 'PENDING',
    ticketNumber: view.ticketNumber,
    title: view.title,
    description: view.description,
    fields: view.fields,
  }
}

/** Ferramentas do turno. O id do funcionário vem do servidor (nunca do modelo): garante a privacidade. */
export function createServiceDeskTools(deps: ToolDeps, ctx: TurnContext) {
  const employeeId = ctx.employee.id

  const listarMeusChamados = createTool({
    id: 'listar_meus_chamados',
    description:
      'Lista os chamados do funcionário. "abertos" inclui os em andamento e os resolvidos há até 7 dias; "todos" inclui o histórico.',
    inputSchema: z.object({ escopo: z.enum(['abertos', 'todos']).default('abertos') }),
    execute: async ({ escopo }) =>
      instrumented(ctx, { tool: 'listar_meus_chamados', label: 'consultou seus chamados' }, { escopo }, async () => {
        const tickets = await withLegacyRetry(() =>
          deps.tickets.listForRequester(employeeId, escopo === 'todos' ? 'all' : 'open'),
        )
        return tickets.map((t) => ({
          numero: t.number,
          titulo: t.title,
          tipo: t.typeLabel,
          categoria: t.categoryLabel,
          prioridade: t.priorityLabel,
          status: t.statusLabel,
          vencido: t.overdue,
          prazo: t.dueLabel,
          ultima_atualizacao: t.updatedAt,
          resolvido_em: t.resolvedAt,
        }))
      }),
  })

  const consultarChamado = createTool({
    id: 'consultar_chamado',
    description: 'Consulta os detalhes e as últimas atualizações de um chamado do funcionário.',
    inputSchema: z.object({ numero: ticketNumber }),
    execute: async ({ numero }) =>
      instrumented(ctx, { tool: 'consultar_chamado', label: `consultou o ${numero}` }, { numero }, () =>
        withLegacyRetry(() => deps.tickets.getForRequester(employeeId, numero)),
      ),
  })

  const buscarCentralDeAjuda = createTool({
    id: 'buscar_central_de_ajuda',
    description: 'Busca artigos na central de ajuda de TI. Use palavras-chave do problema (ex.: "vpn erro 809").',
    inputSchema: z.object({ consulta: z.string().min(2).max(200) }),
    execute: async ({ consulta }) =>
      instrumented(ctx, { tool: 'buscar_central_de_ajuda', label: 'buscou na central de ajuda' }, { consulta }, () =>
        deps.knowledge.search(consulta),
      ),
  })

  const mostrarSelecaoDeChamados = createTool({
    id: 'mostrar_selecao_de_chamados',
    description:
      'Mostra ao funcionário um seletor com os chamados abertos dele, para ele escolher sobre qual quer falar.',
    inputSchema: z.object({}),
    execute: async () =>
      instrumented(ctx, { tool: 'mostrar_selecao_de_chamados' }, {}, async () => {
        const tickets = (await withLegacyRetry(() => deps.tickets.listForRequester(employeeId, 'open'))).filter(
          (t) => t.status !== 'RESOLVIDO',
        )
        ctx.addPart({ type: 'ticket-select', tickets })
        return { exibidos: tickets.length }
      }),
  })

  const mostrarChamado = createTool({
    id: 'mostrar_chamado',
    description: 'Mostra o card com os detalhes de um chamado do funcionário (status, prioridade, prazo, vencimento).',
    inputSchema: z.object({ numero: ticketNumber }),
    execute: async ({ numero }) =>
      instrumented(ctx, { tool: 'mostrar_chamado', label: 'calculou o prazo' }, { numero }, async () => {
        const ticket = await withLegacyRetry(() => deps.tickets.getForRequester(employeeId, numero))
        const { updates: _updates, ...card } = ticket
        ctx.addPart({ type: 'ticket', ticket: card })
        return { exibido: numero, vencido: ticket.overdue, prazo: ticket.dueLabel, status: ticket.statusLabel }
      }),
  })

  const oferecerOpcoes = createTool({
    id: 'oferecer_opcoes',
    description:
      'Mostra botões de resposta rápida abaixo da sua mensagem. Use para perguntas com poucas alternativas. A pergunta aparece em destaque.',
    inputSchema: z.object({
      pergunta: z.string().max(140).optional(),
      opcoes: z.array(z.string().min(1).max(40)).min(2).max(4),
    }),
    execute: async ({ pergunta, opcoes }) =>
      instrumented(ctx, { tool: 'oferecer_opcoes' }, { pergunta, opcoes }, () => {
        if (ctx.parts.some((p) => p.type === 'draft')) {
          throw new BadRequestException(
            'Já há um rascunho neste turno: peça só a confirmação no card, sem novas perguntas.',
          )
        }
        ctx.addPart({ type: 'options', question: pergunta, options: opcoes })
        return Promise.resolve({ exibido: true })
      }),
  })

  const proporNovoChamado = createTool({
    id: 'propor_novo_chamado',
    description:
      'Monta o rascunho de um chamado novo para o funcionário confirmar. A prioridade é calculada pelo sistema a partir de afetados × urgência (regra do service desk). Verifica duplicidade: se houver chamado parecido, retorna os candidatos e não cria o rascunho. Só chame quando o funcionário já tiver dito quem é afetado e a urgência.',
    inputSchema: z.object({
      tipo: z.enum(['INC', 'REQ']),
      titulo: z.string().min(5).max(120),
      descricao: z
        .string()
        .min(10)
        .max(1500)
        .describe('Descrição completa: o que acontece, desde quando, erro, impacto.'),
      categoria: z.enum(['ACESSO', 'REDE_VPN', 'HARDWARE', 'SOFTWARE', 'EMAIL', 'OUTROS']),
      afetados: z
        .enum(['SOMENTE_EU', 'EQUIPE', 'EMPRESA', 'NAO_SEI'])
        .describe('Conforme o funcionário informou. NAO_SEI só se ele respondeu "não sei".'),
      urgencia: z
        .enum(['PARADO', 'ATRAPALHA', 'SEM_URGENCIA'])
        .describe(
          'PARADO: não consegue trabalhar ou há compromisso hoje; ATRAPALHA: há alternativa; SEM_URGENCIA: pedido/melhoria.',
        ),
      ignorar_duplicados: z
        .boolean()
        .default(false)
        .describe('true somente se você já verificou os candidatos e o problema é realmente diferente'),
    }),
    execute: async (input) =>
      instrumented(ctx, { tool: 'propor_novo_chamado', label: 'montou o rascunho' }, input, async () => {
        if (ctx.parts.some((p) => p.type === 'options')) {
          throw new BadRequestException(
            'Você já fez uma pergunta neste turno: aguarde a resposta antes de propor o rascunho.',
          )
        }
        ctx.addStep('classificou a prioridade')
        if (!input.ignorar_duplicados) {
          const duplicates = await deps.tickets.findPossibleDuplicates(
            employeeId,
            input.categoria,
            input.titulo,
            input.descricao,
          )
          if (duplicates.length > 0) {
            ctx.addStep('verificou duplicidade')
            return {
              rascunho_criado: false,
              possiveis_duplicados: duplicates.map((d) => ({
                numero: d.number,
                titulo: d.title,
                status: d.statusLabel,
              })),
              orientacao:
                'Já existe chamado parecido. Pergunte se é o mesmo problema; se for, proponha a atualização dele.',
            }
          }
        }

        const priority = priorityFor(input.afetados, input.urgencia)
        const dueAt = computeDueAt(priority)
        const part = await createDraft(
          deps,
          ctx,
          'CREATE',
          {
            type: input.tipo,
            title: input.titulo,
            description: input.descricao,
            category: input.categoria,
            priority,
            affected: input.afetados,
          },
          {
            title: input.titulo,
            description: input.descricao,
            fields: [
              { label: 'Tipo', value: TYPE_LABEL[input.tipo] },
              { label: 'Categoria', value: CATEGORY_LABEL[input.categoria] },
              {
                label: 'Prioridade',
                value: PRIORITY_LABEL[priority],
                dot: PRIORITY_TONE[priority],
                note: `· resposta até ${formatBrt(dueAt)}`,
              },
              { label: 'Afetados', value: AFFECTED_LABEL[input.afetados] },
              { label: 'Urgência', value: URGENCY_LABEL[input.urgencia] },
            ],
          },
        )
        ctx.addPart(part)
        return {
          rascunho_criado: true,
          codigo: part.code,
          prioridade_calculada: PRIORITY_LABEL[priority],
          prazo_resposta: formatBrt(dueAt),
        }
      }),
  })

  const proporAtualizacao = createTool({
    id: 'propor_atualizacao',
    description:
      'Monta o rascunho de uma atualização de chamado existente (complemento, mudança de prioridade ou reabertura de resolvido há até 7 dias) para o funcionário confirmar.',
    inputSchema: z.object({
      numero: ticketNumber,
      comentario: z.string().min(3).max(1500).describe('Informação nova, escrita a partir do que o funcionário disse.'),
      nova_prioridade: z.enum(['CRITICA', 'ALTA', 'MEDIA', 'BAIXA']).optional(),
      reabrir: z.boolean().default(false),
    }),
    execute: async (input) =>
      instrumented(ctx, { tool: 'propor_atualizacao', label: 'montou a atualização' }, input, async () => {
        const ticket = await withLegacyRetry(() => deps.tickets.getForRequester(employeeId, input.numero))
        if (ticket.status === 'RESOLVIDO' && !input.reabrir) {
          throw new BadRequestException(`O ${input.numero} está resolvido; para complementar é preciso reabrir.`)
        }
        if (ticket.status === 'RESOLVIDO' && ticket.resolvedAt) {
          const days = (Date.now() - new Date(ticket.resolvedAt).getTime()) / 86_400_000
          if (days > 7)
            throw new BadRequestException(`O ${input.numero} foi resolvido há mais de 7 dias; abra um chamado novo.`)
        }
        const priority = input.nova_prioridade ?? ticket.priority
        const changes: DraftField[] = [{ label: 'Chamado', value: ticket.number }]
        if (input.reabrir) changes.push({ label: 'Status', value: 'Reabrir', tone: 'warning' })
        changes.push({
          label: 'Prioridade',
          value: PRIORITY_LABEL[priority],
          dot: PRIORITY_TONE[priority],
          note:
            input.nova_prioridade && input.nova_prioridade !== ticket.priority
              ? `· antes ${ticket.priorityLabel}`
              : undefined,
        })
        const dbTicket = await deps.prisma.ticket.findUniqueOrThrow({ where: { number: ticket.number } })
        const part = await createDraft(
          deps,
          ctx,
          'UPDATE',
          { number: ticket.number, comment: input.comentario, priority: input.nova_prioridade, reopen: input.reabrir },
          {
            title: `Atualizar ${ticket.number}: ${ticket.title}`,
            description: input.comentario,
            fields: changes,
            ticketNumber: ticket.number,
            ticketId: dbTicket.id,
          },
        )
        ctx.addPart(part)
        return { rascunho_criado: true, codigo: part.code }
      }),
  })

  const transferirParaAnalista = createTool({
    id: 'transferir_para_analista',
    description:
      'Transfere a conversa para um analista do Suporte N2. Depois disso você não responde mais nesta conversa até ela ser devolvida.',
    inputSchema: z.object({
      motivo: z.enum(['PEDIDO_USUARIO', 'CRITICO', 'VENCIDO', 'BAIXA_CONFIANCA']),
      resumo: z.string().min(10).max(600).describe('Resumo do caso para o analista não precisar perguntar de novo.'),
      numero_chamado: ticketNumber.optional(),
    }),
    execute: async (input) =>
      instrumented(ctx, { tool: 'transferir_para_analista', label: 'transferiu para um analista' }, input, async () => {
        ctx.handoff = { reason: input.motivo, summary: input.resumo }
        if (input.numero_chamado) {
          const ticket = await withLegacyRetry(() =>
            deps.tickets.markWaitingAnalyst(employeeId, input.numero_chamado!, input.resumo),
          )
          const dbTicket = await deps.prisma.ticket.findUniqueOrThrow({ where: { number: ticket.number } })
          ctx.conversation.ticketId = dbTicket.id
        }
        return { transferido: true, fila: 'Suporte N2', prazo_contato: '2 h úteis' }
      }),
  })

  const registrarDecisao = createTool({
    id: 'registrar_decisao',
    description:
      'Registra, para auditoria e transparência, o que você entendeu e decidiu neste turno. Chame uma vez por turno.',
    inputSchema: z.object({
      intencao: z.string().max(120).describe('O que o funcionário quer, em poucas palavras.'),
      acao: z.string().max(120).describe('O que você fez ou vai fazer.'),
      confianca: z.number().min(0).max(1),
      motivo: z.string().max(400).describe('Por que esta ação, citando as regras/dados usados.'),
    }),
    execute: (input) => {
      ctx.decision = {
        intent: input.intencao,
        action: input.acao,
        confidence: input.confianca,
        reasoning: input.motivo,
      }
      return Promise.resolve({ registrado: true })
    },
  })

  return {
    listar_meus_chamados: listarMeusChamados,
    consultar_chamado: consultarChamado,
    buscar_central_de_ajuda: buscarCentralDeAjuda,
    mostrar_selecao_de_chamados: mostrarSelecaoDeChamados,
    mostrar_chamado: mostrarChamado,
    oferecer_opcoes: oferecerOpcoes,
    propor_novo_chamado: proporNovoChamado,
    propor_atualizacao: proporAtualizacao,
    transferir_para_analista: transferirParaAnalista,
    registrar_decisao: registrarDecisao,
  }
}

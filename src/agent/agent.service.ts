import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AgentDecision, Conversation, Message, Prisma } from '@prisma/client'
import { ConversationsService } from '../conversations/conversations.service'
import type { MessagePart } from '../conversations/message-parts'
import { KnowledgeService } from '../knowledge/knowledge.service'
import { PrismaService } from '../prisma/prisma.service'
import { RealtimeService } from '../realtime/realtime.service'
import { formatBrt } from '../service-desk/sla'
import { withLegacyRetry } from '../tickets/legacy-system'
import { TicketsService } from '../tickets/tickets.service'
import { NEXO_INSTRUCTIONS } from './agent.instructions'
import { createServiceDeskTools } from './agent.tools'
import { Agent } from './mastra'
import { TurnContext } from './turn-context'

type ChatMessage =
  { role: 'user'; content: string } | { role: 'assistant'; content: string } | { role: 'system'; content: string }

/** Variável de ambiente com a chave de cada provedor suportado pelo roteador do Mastra. */
const PROVIDER_KEYS: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
}

/** Abaixo disso o servidor transfere mesmo que o modelo não tenha transferido (rede de segurança). */
const MIN_CONFIDENCE = 0.4
const HISTORY_SIZE = 24

const HANDOFF_TEXT = {
  PEDIDO_USUARIO: 'a pedido do funcionário',
  CRITICO: 'caso crítico',
  VENCIDO: 'chamado vencido',
  BAIXA_CONFIANCA: 'o agent não teve segurança',
} as const

/** Descreve os blocos de uma mensagem antiga para o modelo saber o que foi mostrado. */
function describeParts(parts: MessagePart[]): string {
  return parts
    .map((part) => {
      switch (part.type) {
        case 'options':
          return `[opções mostradas: ${part.options.join(' | ')}]`
        case 'ticket-select':
          return `[seletor com os chamados: ${part.tickets.map((t) => `${t.number} (${t.title})`).join(', ')}]`
        case 'ticket':
          return `[card do chamado ${part.ticket.number}]`
        case 'draft': {
          const status = { PENDING: 'aguardando confirmação', CONFIRMED: 'confirmado', CANCELED: 'cancelado' }[
            part.status
          ]
          return `[rascunho ${part.code} (${part.kind === 'CREATE' ? 'novo chamado' : `atualização do ${part.ticketNumber}`}): ${status}]`
        }
      }
    })
    .join(' ')
}

function toModelMessages(history: (Message & { decision: AgentDecision | null })[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  for (const m of history) {
    const parts = describeParts(m.parts as MessagePart[])
    switch (m.role) {
      case 'USER':
        messages.push({ role: 'user', content: m.content })
        break
      case 'AGENT':
        messages.push({ role: 'assistant', content: [m.content, parts].filter(Boolean).join('\n') || '(sem texto)' })
        break
      case 'ANALYST':
        messages.push({ role: 'assistant', content: `(Mensagem do analista): ${m.content}` })
        break
      case 'SYSTEM':
        messages.push({ role: 'assistant', content: `(Evento do sistema): ${m.content}` })
        break
    }
  }
  // O histórico enviado ao modelo começa sempre por uma fala do funcionário
  while (messages.length && messages[0].role !== 'user') messages.shift()
  return messages
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name)
  /** Um turno por conversa por vez: mensagens seguidas entram na fila. */
  private readonly queues = new Map<string, Promise<void>>()

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly tickets: TicketsService,
    private readonly knowledge: KnowledgeService,
    private readonly realtime: RealtimeService,
  ) {}

  respond(conversationId: string): Promise<void> {
    const previous = this.queues.get(conversationId) ?? Promise.resolve()
    const next = previous.then(() => this.runTurn(conversationId)).catch(() => undefined)
    this.queues.set(conversationId, next)
    void next.finally(() => {
      if (this.queues.get(conversationId) === next) this.queues.delete(conversationId)
    })
    return next
  }

  private async runTurn(conversationId: string) {
    const conversation = await this.conversations.get(conversationId)
    // O agent não responde enquanto a conversa está com um analista (ou aguardando)
    if (conversation.mode !== 'AGENT') return

    const employee = await this.prisma.user.findUniqueOrThrow({ where: { id: conversation.employeeId } })
    const emitStatus = (step?: string) =>
      this.realtime.agentStatus(employee.id, { conversationId, status: 'thinking', step })

    const ctx = new TurnContext(conversation, employee, (label) => emitStatus(label))
    emitStatus()
    const started = Date.now()
    const model = this.config.get<string>('LLM_MODEL', 'openai/gpt-4.1-mini')

    try {
      const keyVar = PROVIDER_KEYS[model.split('/')[0]]
      if (keyVar && !this.config.get<string>(keyVar)) {
        throw new MissingApiKeyError(keyVar)
      }

      const [history, myTickets] = await Promise.all([
        this.conversations.recentMessages(conversationId, HISTORY_SIZE),
        // Lista compacta para o modelo resolver referências ("o do notebook"); se o legado falhar, segue sem ela
        withLegacyRetry(() => this.tickets.listForRequester(employee.id, 'open')).catch(() => null),
      ])
      const maxMessages = this.config.get<number>('MAX_SESSION_MESSAGES', 30)
      const turnContext: ChatMessage = {
        role: 'system',
        content: [
          `Funcionário: ${employee.name}${employee.department ? ` (${employee.department})` : ''}.`,
          `Agora: ${formatBrt(new Date())} de ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit' })} (Brasília).`,
          `Mensagens do funcionário nesta sessão: ${conversation.userMessageCount}/${maxMessages}.`,
          myTickets
            ? `Chamados do funcionário (abertos ou resolvidos há até 7 dias): ${
                myTickets
                  .map((t) => `${t.number} "${t.title}" — ${t.statusLabel}${t.overdue ? ', vencido' : ''}`)
                  .join('; ') || 'nenhum'
              }. Use os números ao chamar as ferramentas.`
            : 'Lista de chamados indisponível agora (sistema instável).',
        ].join(' '),
      }

      const agent = this.buildAgent(model, ctx)

      const result = await agent.generate([turnContext, ...toModelMessages(history)], {
        maxSteps: 8,
        modelSettings: { temperature: 0.2, maxOutputTokens: 700, timeout: { totalMs: 60_000 } },
      })

      const usage = { input: result.usage?.inputTokens ?? 0, output: result.usage?.outputTokens ?? 0 }
      // `result.text` junta o texto de todas as etapas; a resposta ao funcionário é a da última etapa com texto
      const reply = ([...(result.steps ?? [])].reverse().find((step) => step.text?.trim())?.text ?? result.text).trim()

      // Rede de segurança da transparência: se o modelo não registrou a decisão, uma chamada curta o obriga
      if (!ctx.decision) {
        const extra = await this.recoverDecision(agent, history, reply, ctx)
        usage.input += extra.input
        usage.output += extra.output
      }

      await this.finishTurn(conversation, ctx, {
        text: reply,
        model,
        latencyMs: Date.now() - started,
        inputTokens: usage.input || null,
        outputTokens: usage.output || null,
      })
    } catch (error) {
      this.logger.error(`Falha no turno do agent (${conversationId})`, error instanceof Error ? error.stack : error)
      await this.conversations.addMessage(conversation, {
        role: 'AGENT',
        content:
          error instanceof MissingApiKeyError
            ? 'O assistente está sem configuração no momento. Avise a equipe de TI ou ligue no ramal 4000.'
            : 'Tive um problema para responder agora. Pode tentar de novo em instantes?',
        decision: {
          intent: 'não identificada',
          action: 'erro',
          confidence: null,
          reasoning: error instanceof MissingApiKeyError ? error.message : 'Falha ao chamar o modelo de linguagem.',
          steps: ctx.steps,
          toolCalls: ctx.toolCalls as unknown as Prisma.InputJsonValue,
          model,
          latencyMs: Date.now() - started,
        },
      })
    } finally {
      this.realtime.agentStatus(employee.id, { conversationId, status: 'idle' })
    }
  }

  /** Agent do turno: as ferramentas recebem o contexto (funcionário, conversa) do servidor. */
  private buildAgent(model: string, ctx: TurnContext) {
    return new Agent({
      id: 'nexo-assist',
      name: 'Nexo Assist',
      instructions: NEXO_INSTRUCTIONS,
      model,
      tools: createServiceDeskTools({ prisma: this.prisma, tickets: this.tickets, knowledge: this.knowledge }, ctx),
    })
  }

  /** Pede ao modelo apenas o registro da decisão do turno que acabou (sem gerar nova resposta). */
  private async recoverDecision(
    agent: ReturnType<AgentService['buildAgent']>,
    history: (Message & { decision: AgentDecision | null })[],
    reply: string,
    ctx: TurnContext,
  ) {
    try {
      const actions = ctx.toolCalls.map((t) => t.tool).join(', ') || 'nenhuma ferramenta'
      const result = await agent.generate(
        [
          ...toModelMessages(history),
          { role: 'assistant', content: reply || '(sem texto)' },
          {
            role: 'user',
            content: `(Sistema) Registre agora a decisão do turno anterior com registrar_decisao. Ferramentas usadas: ${actions}. Não responda ao funcionário.`,
          },
        ],
        {
          maxSteps: 1,
          toolChoice: { type: 'tool', toolName: 'registrar_decisao' },
          modelSettings: { temperature: 0, maxOutputTokens: 300 },
        },
      )
      return { input: result.usage?.inputTokens ?? 0, output: result.usage?.outputTokens ?? 0 }
    } catch (error) {
      this.logger.warn(
        `Não foi possível recuperar a decisão: ${error instanceof Error ? error.message : String(error)}`,
      )
      return { input: 0, output: 0 }
    }
  }

  private async finishTurn(
    conversation: Conversation,
    ctx: TurnContext,
    run: { text: string; model: string; latencyMs: number; inputTokens: number | null; outputTokens: number | null },
  ) {
    const decision = ctx.decision ?? {
      intent: 'não registrada',
      action: ctx.toolCalls.map((t) => t.label).join(', ') || 'respondeu',
      confidence: null,
      reasoning: 'O modelo não registrou a decisão neste turno.',
    }

    // Num mesmo turno não se pergunta e propõe ao mesmo tempo: com pergunta pendente, o rascunho é descartado
    let discardedDraft = false
    const asking = ctx.parts.some((p) => p.type === 'options')
    const drafted = ctx.parts.filter((p) => p.type === 'draft')
    if (asking && drafted.length) {
      await this.prisma.ticketDraft.updateMany({
        where: { id: { in: drafted.map((d) => d.draftId) } },
        data: { status: 'CANCELED', resolvedAt: new Date() },
      })
      ctx.parts.splice(0, ctx.parts.length, ...ctx.parts.filter((p) => p.type !== 'draft'))
      ctx.draftIds.length = 0
      ctx.addStep('aguardou sua resposta antes do rascunho')
      discardedDraft = true
    }

    // Rede de segurança: confiança baixa sem transferência → transfere
    if (!ctx.handoff && decision.confidence !== null && decision.confidence < MIN_CONFIDENCE) {
      ctx.handoff = {
        reason: 'BAIXA_CONFIANCA',
        summary: `Confiança ${Math.round(decision.confidence * 100)}%. Intenção entendida: ${decision.intent}. ${decision.reasoning}`,
      }
      ctx.addStep('pediu ajuda a um analista')
    }

    // A pergunta das opções já aparece em destaque no card: não repete no texto
    const options = ctx.parts.find((p) => p.type === 'options')
    const normalize = (t: string) =>
      t
        .toLowerCase()
        .replace(/[^\p{L}\p{N} ]/gu, '')
        .trim()
    const repeatsQuestion =
      options?.type === 'options' && !!options.question && normalize(run.text).startsWith(normalize(options.question))

    const text =
      (discardedDraft
        ? 'Antes de montar o rascunho, preciso confirmar uma informação.'
        : repeatsQuestion
          ? ''
          : run.text) ||
      (ctx.handoff
        ? 'Vou chamar um analista para te ajudar. Ele vai falar com você por aqui.'
        : options
          ? ''
          : 'Pode me dar mais detalhes?')

    const message = await this.conversations.addMessage(conversation, {
      role: 'AGENT',
      content: text,
      parts: ctx.parts,
      decision: {
        intent: decision.intent,
        action: decision.action,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        steps: ctx.steps,
        toolCalls: ctx.toolCalls as unknown as Prisma.InputJsonValue,
        model: run.model,
        latencyMs: run.latencyMs,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
      },
    })

    if (ctx.draftIds.length) {
      await this.prisma.ticketDraft.updateMany({ where: { id: { in: ctx.draftIds } }, data: { messageId: message.id } })
    }

    // Rascunhos pendentes substituídos por um novo neste turno: o card antigo passa a "cancelado"
    for (const old of ctx.supersededDrafts) {
      if (!old.messageId) continue
      await this.conversations.updateMessageParts(old.messageId, (parts) =>
        parts.map((p) => (p.type === 'draft' && p.draftId === old.id ? { ...p, status: 'CANCELED' as const } : p)),
      )
    }

    if (ctx.handoff) {
      const updated = await this.conversations.update(conversation.id, {
        mode: 'WAITING_HUMAN',
        handoffReason: ctx.handoff.reason,
        handoffSummary: ctx.handoff.summary,
        ticketId: ctx.conversation.ticketId ?? conversation.ticketId,
        unreadForAnalyst: { increment: 1 },
      })
      await this.conversations.addMessage(updated, {
        role: 'SYSTEM',
        content: `Transferida para Suporte N2 (${HANDOFF_TEXT[ctx.handoff.reason]}) · ${formatBrt(new Date())}`,
        parts: [],
      })
    }
  }
}

class MissingApiKeyError extends Error {
  constructor(keyVar: string) {
    super(`${keyVar} não configurada no .env da API.`)
  }
}

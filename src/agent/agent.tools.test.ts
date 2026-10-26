import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import type { Conversation } from '@prisma/client'
import { createServiceDeskTools, type ToolDeps } from './agent.tools'
import { Agent } from './mastra'
import { TurnContext } from './turn-context'
import { LegacyUnavailableError } from '../tickets/legacy-system'

/**
 * Modelo de linguagem simulado (spec v2 do AI SDK): devolve um roteiro fixo de chamadas de
 * ferramenta e depois um texto. Valida a integração real com o Mastra sem chamar o provedor.
 */
function scriptedModel(script: { tools: { name: string; input: object }[]; text: string }) {
  let call = 0
  const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
  const stream = (parts: object[]) =>
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part)
        controller.close()
      },
    })

  /** Primeira chamada: as ferramentas do roteiro. Depois: o texto final. */
  const nextContent = () =>
    call++ === 0
      ? {
          finishReason: 'tool-calls' as const,
          content: script.tools.map((t, i) => ({
            type: 'tool-call' as const,
            toolCallId: `call-${i}`,
            toolName: t.name,
            input: JSON.stringify(t.input),
          })),
        }
      : { finishReason: 'stop' as const, content: [{ type: 'text' as const, text: script.text }] }

  return {
    specificationVersion: 'v2' as const,
    provider: 'test',
    modelId: 'scripted',
    supportedUrls: {},
    doGenerate: () => Promise.resolve({ ...nextContent(), usage, warnings: [] }),
    doStream: () => {
      const { finishReason, content } = nextContent()
      const parts: object[] = [
        { type: 'stream-start', warnings: [] },
        ...(content as { type: string; text?: string }[]).flatMap((c): object[] =>
          c.type === 'text'
            ? [
                { type: 'text-start', id: 't' },
                { type: 'text-delta', id: 't', delta: c.text ?? '' },
                { type: 'text-end', id: 't' },
              ]
            : [c],
        ),
        { type: 'finish', finishReason, usage },
      ]
      return Promise.resolve({ stream: stream(parts) })
    },
  }
}

const ticket = {
  number: 'INC-20311',
  title: 'Notebook lento',
  typeLabel: 'Incidente',
  categoryLabel: 'Hardware',
  priorityLabel: 'Média',
  status: 'AGUARDANDO_ANALISTA',
  statusLabel: 'Aguardando analista',
  overdue: true,
  dueLabel: '20 out, 10:00',
  updatedAt: new Date().toISOString(),
  resolvedAt: null,
}

type Fn = (...args: unknown[]) => Promise<unknown>

function setup(overrides: Record<string, Fn> = {}) {
  const tickets = {
    listForRequester: mock.fn<Fn>(() => Promise.resolve([ticket])),
    getForRequester: mock.fn<Fn>(() => Promise.resolve({ ...ticket, updates: [] })),
    findPossibleDuplicates: mock.fn<Fn>(() => Promise.resolve([])),
    ...overrides,
  }
  const deps = {
    tickets,
    knowledge: { search: () => Promise.resolve([]) },
    prisma: {},
  } as unknown as ToolDeps
  const steps: string[] = []
  const ctx = new TurnContext(
    { id: 'conv-1', employeeId: 'emp-1', ticketId: null } as Conversation,
    { id: 'emp-1', name: 'Ana', department: null },
    (s) => steps.push(s),
  )
  return { deps, ctx, tickets, steps }
}

async function run(deps: ToolDeps, ctx: TurnContext, script: Parameters<typeof scriptedModel>[0]) {
  const agent = new Agent({
    id: 'test',
    name: 'test',
    instructions: 'teste',
    model: scriptedModel(script),
    tools: createServiceDeskTools(deps, ctx),
  })
  // Mesmo formato usado pelo AgentService: contexto do turno + histórico
  return agent.generate(
    [
      { role: 'system', content: 'Funcionário: Ana.' },
      { role: 'user', content: 'Oi' },
      { role: 'assistant', content: 'Olá! Como posso ajudar?' },
      { role: 'user', content: 'Qual o status do meu chamado?' },
    ],
    { maxSteps: 4 },
  )
}

void describe('ferramentas do agent (integração com Mastra)', () => {
  void it('executa as ferramentas, monta os blocos e registra a decisão', async () => {
    const { deps, ctx, tickets, steps } = setup()

    const result = await run(deps, ctx, {
      tools: [
        { name: 'mostrar_chamado', input: { numero: 'inc-20311' } },
        { name: 'oferecer_opcoes', input: { opcoes: ['Falar com um analista', 'Não, obrigado'] } },
        {
          name: 'registrar_decisao',
          input: { intencao: 'status do chamado', acao: 'mostrou o chamado', confianca: 0.9, motivo: 'Vencido.' },
        },
      ],
      text: 'Está vencido. Quer falar com um analista?',
    })

    assert.equal(result.text, 'Está vencido. Quer falar com um analista?')
    // O id do funcionário vem do contexto do servidor e o número é normalizado
    assert.deepEqual(tickets.getForRequester.mock.calls[0].arguments, ['emp-1', 'INC-20311'])
    assert.deepEqual(
      ctx.parts.map((p) => p.type),
      ['ticket', 'options'],
    )
    assert.equal(ctx.decision?.confidence, 0.9)
    assert.equal(ctx.decision?.intent, 'status do chamado')
    assert.ok(steps.includes('calculou o prazo'))
    assert.ok(ctx.toolCalls.every((c) => c.ok))
  })

  void it('transforma indisponibilidade do legado em erro estruturado para o modelo', async () => {
    const { deps, ctx } = setup({ listForRequester: () => Promise.reject(new LegacyUnavailableError()) })

    await run(deps, ctx, { tools: [{ name: 'listar_meus_chamados', input: {} }], text: 'Sistema instável.' })

    assert.equal(ctx.toolCalls[0].tool, 'listar_meus_chamados')
    assert.equal(ctx.toolCalls[0].ok, false)
    assert.match(ctx.toolCalls[0].summary, /sistema_de_chamados_indisponivel/)
  })
})

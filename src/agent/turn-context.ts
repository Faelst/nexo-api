import type { Conversation, HandoffReason } from '@prisma/client'
import type { MessagePart, ToolCallLog } from '../conversations/message-parts'

export type RegisteredDecision = {
  intent: string
  action: string
  confidence: number
  reasoning: string
}

/**
 * Estado de um turno do agent. As ferramentas escrevem aqui (blocos da interface, passos, decisão)
 * e o AgentService monta a mensagem final a partir disso.
 */
export class TurnContext {
  readonly parts: MessagePart[] = []
  readonly steps: string[] = []
  readonly toolCalls: ToolCallLog[] = []
  decision: RegisteredDecision | null = null
  handoff: { reason: HandoffReason; summary: string } | null = null
  /** Rascunhos criados neste turno (ligados à mensagem do agent depois de salva). */
  readonly draftIds: string[] = []
  /** Rascunhos pendentes anteriores que um novo rascunho substituiu (só um pendente por conversa). */
  readonly supersededDrafts: { id: string; messageId: string | null }[] = []

  constructor(
    readonly conversation: Conversation,
    readonly employee: { id: string; name: string; department: string | null },
    private readonly onStep: (label: string) => void,
  ) {}

  addStep(label: string) {
    if (!this.steps.includes(label)) {
      this.steps.push(label)
      this.onStep(label)
    }
  }

  addPart(part: MessagePart) {
    // Um único bloco de opções por mensagem: o último prevalece
    if (part.type === 'options') {
      const index = this.parts.findIndex((p) => p.type === 'options')
      if (index >= 0) this.parts.splice(index, 1)
    }
    this.parts.push(part)
  }
}

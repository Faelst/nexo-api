import type { TicketDto, Tone } from '../tickets/ticket.mapper'

/** Blocos ricos de uma mensagem. Contrato compartilhado com o frontend. */
export type DraftField = { label: string; value: string; tone?: Tone; dot?: Tone; note?: string }

export type DraftPart = {
  type: 'draft'
  draftId: string
  code: string
  kind: 'CREATE' | 'UPDATE'
  status: 'PENDING' | 'CONFIRMED' | 'CANCELED'
  ticketNumber?: string
  title: string
  description: string
  fields: DraftField[]
}

export type MessagePart =
  | { type: 'options'; question?: string; options: string[] }
  | { type: 'ticket-select'; tickets: TicketDto[] }
  | { type: 'ticket'; ticket: TicketDto }
  | DraftPart

export type ToolCallLog = {
  tool: string
  label: string
  input: unknown
  ok: boolean
  durationMs: number
  summary: string
}

export type DecisionDto = {
  intent: string
  action: string
  confidence: number | null
  reasoning: string
  steps: string[]
  toolCalls: ToolCallLog[]
  model: string | null
  latencyMs: number | null
  inputTokens: number | null
  outputTokens: number | null
}

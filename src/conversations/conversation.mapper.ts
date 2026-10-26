import type { AgentDecision, Conversation, Message, Ticket, User } from '@prisma/client'
import { toUserDto } from '../auth/auth.service'
import type { DecisionDto, MessagePart, ToolCallLog } from './message-parts'

type MessageWithRelations = Message & { decision?: AgentDecision | null }

export function toDecisionDto(decision: AgentDecision): DecisionDto {
  return {
    intent: decision.intent,
    action: decision.action,
    confidence: decision.confidence,
    reasoning: decision.reasoning,
    steps: decision.steps as string[],
    toolCalls: decision.toolCalls as ToolCallLog[],
    model: decision.model,
    latencyMs: decision.latencyMs,
    inputTokens: decision.inputTokens,
    outputTokens: decision.outputTokens,
  }
}

export function toMessageDto(message: MessageWithRelations, authors: Map<string, User> = new Map()) {
  const author = message.authorId ? authors.get(message.authorId) : undefined
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    author: author ? { name: author.name, team: author.team } : null,
    parts: message.parts as MessagePart[],
    createdAt: message.createdAt.toISOString(),
    decision: message.decision ? toDecisionDto(message.decision) : null,
  }
}

export type MessageDto = ReturnType<typeof toMessageDto>

type ConversationWithRelations = Conversation & {
  employee: User
  analyst?: User | null
  ticket?: Ticket | null
  messages?: Message[]
}

export function toConversationDto(conversation: ConversationWithRelations, options: { online?: boolean } = {}) {
  const last = conversation.messages?.[0]
  return {
    id: conversation.id,
    mode: conversation.mode,
    title: conversation.title,
    employee: { ...toUserDto(conversation.employee), online: options.online ?? false },
    analyst: conversation.analyst ? { id: conversation.analyst.id, name: conversation.analyst.name } : null,
    ticketNumber: conversation.ticket?.number ?? null,
    handoffReason: conversation.handoffReason,
    handoffSummary: conversation.handoffSummary,
    lastConfidence: conversation.lastConfidence,
    userMessageCount: conversation.userMessageCount,
    unreadForAnalyst: conversation.unreadForAnalyst,
    lastMessage: last ? { role: last.role, content: last.content, createdAt: last.createdAt.toISOString() } : null,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    createdAt: conversation.createdAt.toISOString(),
  }
}

export type ConversationDto = ReturnType<typeof toConversationDto>

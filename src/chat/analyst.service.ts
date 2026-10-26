import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common'
import { ConversationsService } from '../conversations/conversations.service'
import { formatBrt } from '../service-desk/sla'
import { TicketsService } from '../tickets/tickets.service'
import type { AuthUser } from '../common/types/auth-user'

/** Ações do console do analista: assumir (pausa o agent), devolver, encerrar e responder. */
@Injectable()
export class AnalystService {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly tickets: TicketsService,
  ) {}

  list() {
    return this.conversations.listForAnalysts()
  }

  async messages(conversationId: string) {
    const [conversation, messages] = await Promise.all([
      this.conversations.summary(conversationId),
      this.conversations.listMessages(conversationId),
    ])
    return { conversation, messages }
  }

  async markRead(conversationId: string) {
    await this.conversations.update(conversationId, { unreadForAnalyst: 0 })
  }

  async assume(analyst: AuthUser, conversationId: string) {
    const conversation = await this.conversations.get(conversationId)
    if (conversation.mode === 'HUMAN' && conversation.analystId !== analyst.id) {
      throw new ConflictException('Outro analista já está atendendo esta conversa.')
    }
    const updated = await this.conversations.update(conversationId, {
      mode: 'HUMAN',
      analystId: analyst.id,
      unreadForAnalyst: 0,
      closedAt: null,
    })
    if (conversation.ticketId) await this.tickets.markInProgress(conversation.ticketId, analyst.name)
    await this.conversations.addMessage(updated, {
      role: 'SYSTEM',
      content: `${analyst.name} assumiu · agent pausado · ${formatBrt(new Date())}`,
    })
    return this.conversations.summary(conversationId)
  }

  /** Devolve ao agent: quem está atendendo, ou qualquer analista enquanto a conversa aguarda na fila. */
  async release(analyst: AuthUser, conversationId: string) {
    const conversation = await this.conversations.get(conversationId)
    if (conversation.mode !== 'WAITING_HUMAN') await this.assertAssigned(analyst, conversationId)
    const updated = await this.conversations.update(conversationId, {
      mode: 'AGENT',
      analystId: null,
      handoffReason: null,
      handoffSummary: null,
    })
    await this.conversations.addMessage(updated, {
      role: 'SYSTEM',
      content: `Devolvida ao agent por ${analyst.name} · ${formatBrt(new Date())}`,
    })
    return this.conversations.summary(conversationId)
  }

  async close(analyst: AuthUser, conversationId: string) {
    await this.assertAssigned(analyst, conversationId)
    const updated = await this.conversations.update(conversationId, { mode: 'CLOSED', closedAt: new Date() })
    await this.conversations.addMessage(updated, {
      role: 'SYSTEM',
      content: `Atendimento encerrado por ${analyst.name} · ${formatBrt(new Date())}`,
    })
    return this.conversations.summary(conversationId)
  }

  async send(analyst: AuthUser, conversationId: string, text: string) {
    const conversation = await this.assertAssigned(analyst, conversationId)
    return this.conversations.addMessage(conversation, { role: 'ANALYST', content: text, authorId: analyst.id })
  }

  employeeTickets(employeeId: string) {
    return this.tickets.listForAnalyst(employeeId)
  }

  private async assertAssigned(analyst: AuthUser, conversationId: string) {
    const conversation = await this.conversations.get(conversationId)
    if (conversation.mode !== 'HUMAN' || conversation.analystId !== analyst.id) {
      throw new ForbiddenException('Assuma o atendimento antes de realizar esta ação.')
    }
    return conversation
  }
}

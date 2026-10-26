import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Affected, Priority, TicketCategory, TicketType } from '@prisma/client'
import { AgentService } from '../agent/agent.service'
import { ConversationsService } from '../conversations/conversations.service'
import type { DraftPart } from '../conversations/message-parts'
import { PrismaService } from '../prisma/prisma.service'
import { PRIORITY_LABEL } from '../service-desk/labels'
import { withLegacyRetry } from '../tickets/legacy-system'
import { TicketsService } from '../tickets/tickets.service'
import type { AuthUser } from '../common/types/auth-user'
import type { ConfirmDraftDto } from './dto/draft-action.dto'

type CreatePayload = {
  type: TicketType
  title: string
  description: string
  category: TicketCategory
  priority: Priority
  affected: Affected
}
type UpdatePayload = { number: string; comment: string; priority?: Priority; reopen?: boolean }

/** Fluxos do funcionário: sessão, envio de mensagens e confirmação de rascunhos. */
@Injectable()
export class ChatService {
  private readonly maxMessages: number

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly agent: AgentService,
    private readonly tickets: TicketsService,
  ) {
    this.maxMessages = Number(config.get('MAX_SESSION_MESSAGES', 30))
  }

  async current(employee: AuthUser) {
    const conversation = await this.conversations.getOrCreateCurrent(employee.id)
    return this.snapshot(conversation.id)
  }

  list(employee: AuthUser) {
    return this.conversations.listForEmployee(employee.id)
  }

  /** Conversa do histórico; outra pessoa recebe 404 (não revela que existe). */
  async open(employee: AuthUser, conversationId: string) {
    const conversation = await this.conversations.getForViewer(conversationId, employee)
    return this.snapshot(conversation.id)
  }

  async startNew(employee: AuthUser) {
    const conversation = await this.conversations.startNew(employee.id)
    return this.snapshot(conversation.id)
  }

  async send(employee: AuthUser, conversationId: string, text: string) {
    const conversation = await this.conversations.getForViewer(conversationId, employee)
    if (conversation.mode === 'CLOSED') {
      throw new BadRequestException('Esta conversa foi encerrada. Inicie uma nova conversa para continuar.')
    }
    if (conversation.userMessageCount >= this.maxMessages) {
      throw new BadRequestException(
        `Você atingiu o limite de ${this.maxMessages} mensagens desta sessão. Inicie uma nova conversa para continuar.`,
      )
    }
    const message = await this.conversations.addMessage(conversation, {
      role: 'USER',
      content: text,
      authorId: employee.id,
    })
    // Não aguarda o agent: a resposta chega pelo socket enquanto a interface mostra os passos
    void this.agent.respond(conversation.id)
    return message
  }

  async confirmDraft(employee: AuthUser, dto: ConfirmDraftDto) {
    const draft = await this.findPendingDraft(employee, dto.draftId)
    const conversation = await this.conversations.get(draft.conversationId)
    const author = `${employee.name} (via Nexo Assist)`

    let ticket
    if (draft.kind === 'CREATE') {
      const payload = draft.payload as CreatePayload
      ticket = await withLegacyRetry(() =>
        this.tickets.create(
          employee.id,
          { ...payload, title: dto.title ?? payload.title, description: dto.description ?? payload.description },
          author,
        ),
      )
    } else {
      const payload = draft.payload as UpdatePayload
      ticket = await withLegacyRetry(() =>
        this.tickets.update(
          employee.id,
          payload.number,
          { comment: dto.description ?? payload.comment, priority: payload.priority, reopen: payload.reopen },
          author,
        ),
      )
    }

    await this.prisma.ticketDraft.update({
      where: { id: draft.id },
      data: { status: 'CONFIRMED', resolvedAt: new Date() },
    })
    const dbTicket = await this.prisma.ticket.findUniqueOrThrow({ where: { number: ticket.number } })
    await this.conversations.update(conversation.id, { ticketId: dbTicket.id })
    await this.patchDraftPart(draft.messageId, draft.id, {
      status: 'CONFIRMED',
      ticketNumber: ticket.number,
      ...(dto.title && { title: dto.title }),
      ...(dto.description && { description: dto.description }),
    })

    const created = draft.kind === 'CREATE'
    await this.conversations.addMessage(conversation, {
      role: 'AGENT',
      content: created
        ? `Pronto: abri o ${ticket.number} com prioridade ${PRIORITY_LABEL[ticket.priority].toLowerCase()}. A primeira resposta chega até ${ticket.dueLabel}.`
        : `Pronto: atualizei o ${ticket.number}. O próximo retorno da equipe é até ${ticket.dueLabel}.`,
      decision: {
        intent: created ? 'abrir chamado' : 'atualizar chamado',
        action: created ? `criou o ${ticket.number}` : `atualizou o ${ticket.number}`,
        confidence: 1,
        reasoning: `O funcionário confirmou o rascunho ${draft.code}${dto.title || dto.description ? ' (com edições)' : ''}.`,
        steps: [created ? 'criou o chamado' : 'atualizou o chamado'],
        toolCalls: [],
      },
    })
    return ticket
  }

  async cancelDraft(employee: AuthUser, draftId: string) {
    const draft = await this.findPendingDraft(employee, draftId)
    const conversation = await this.conversations.get(draft.conversationId)
    await this.prisma.ticketDraft.update({
      where: { id: draft.id },
      data: { status: 'CANCELED', resolvedAt: new Date() },
    })
    await this.patchDraftPart(draft.messageId, draft.id, { status: 'CANCELED' })
    await this.conversations.addMessage(conversation, {
      role: 'AGENT',
      content: 'Sem problemas, descartei o rascunho. Se mudar de ideia, é só me chamar.',
      decision: {
        intent: 'cancelar rascunho',
        action: 'descartou o rascunho',
        confidence: 1,
        reasoning: `O funcionário cancelou o rascunho ${draft.code}.`,
        steps: [],
        toolCalls: [],
      },
    })
  }

  private async snapshot(conversationId: string) {
    const [conversation, messages] = await Promise.all([
      this.conversations.summary(conversationId),
      this.conversations.listMessages(conversationId),
    ])
    return { conversation, messages, maxMessages: this.maxMessages }
  }

  private async findPendingDraft(employee: AuthUser, draftId: string) {
    const draft = await this.prisma.ticketDraft.findUnique({ where: { id: draftId }, include: { conversation: true } })
    if (!draft || draft.conversation.employeeId !== employee.id) throw new NotFoundException('Rascunho não encontrado.')
    if (draft.status !== 'PENDING') throw new ConflictException('Este rascunho já foi confirmado ou cancelado.')
    return draft
  }

  private async patchDraftPart(messageId: string | null, draftId: string, patch: Partial<DraftPart>) {
    if (!messageId) return
    await this.conversations.updateMessageParts(messageId, (parts) =>
      parts.map((p) => (p.type === 'draft' && p.draftId === draftId ? { ...p, ...patch } : p)),
    )
  }
}

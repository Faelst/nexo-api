import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { Conversation, MessageRole, Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { RealtimeService } from '../realtime/realtime.service'
import type { AuthUser } from '../common/types/auth-user'
import { toConversationDto, toMessageDto, type MessageDto } from './conversation.mapper'
import type { MessagePart } from './message-parts'

const conversationInclude = {
  employee: true,
  analyst: true,
  ticket: true,
  messages: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.ConversationInclude

const toTitle = (text: string) => {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 60 ? `${clean.slice(0, 57).trimEnd()}…` : clean
}

type NewMessage = {
  role: MessageRole
  content: string
  authorId?: string
  parts?: MessagePart[]
  decision?: Omit<Prisma.AgentDecisionUncheckedCreateInput, 'conversationId' | 'messageId'>
}

/** Persistência de conversas e mensagens + notificação em tempo real. Não contém regras do agent. */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Conversa mais recente em andamento ("voltar outro dia e continuar de onde parou"). */
  async getOrCreateCurrent(employeeId: string): Promise<Conversation> {
    const current = await this.prisma.conversation.findFirst({
      where: { employeeId, mode: { not: 'CLOSED' } },
      orderBy: { lastMessageAt: 'desc' },
    })
    return current ?? this.prisma.conversation.create({ data: { employeeId } })
  }

  /**
   * Nova conversa. As anteriores continuam no histórico (e podem ser retomadas);
   * se já existe uma conversa vazia, ela é reaproveitada para não acumular conversas sem mensagens.
   */
  async startNew(employeeId: string) {
    const empty = await this.prisma.conversation.findFirst({
      where: { employeeId, mode: 'AGENT', messages: { none: {} } },
      orderBy: { createdAt: 'desc' },
    })
    if (empty) return this.prisma.conversation.update({ where: { id: empty.id }, data: { lastMessageAt: new Date() } })
    return this.prisma.conversation.create({ data: { employeeId } })
  }

  /** Histórico do funcionário: conversas com mensagens, mais recentes primeiro. */
  async listForEmployee(employeeId: string) {
    const conversations = await this.prisma.conversation.findMany({
      where: { employeeId, messages: { some: {} } },
      include: conversationInclude,
      orderBy: { lastMessageAt: 'desc' },
      take: 50,
    })
    return conversations.map((c) => toConversationDto(c, { online: true }))
  }

  async get(id: string) {
    const conversation = await this.prisma.conversation.findUnique({ where: { id } })
    if (!conversation) throw new NotFoundException('Conversa não encontrada.')
    return conversation
  }

  /** Funcionário só acessa as próprias conversas; analista acessa todas. */
  async getForViewer(id: string, viewer: AuthUser) {
    const conversation = await this.get(id)
    if (viewer.role === 'EMPLOYEE' && conversation.employeeId !== viewer.id) {
      throw new NotFoundException('Conversa não encontrada.')
    }
    return conversation
  }

  async listMessages(conversationId: string, limit = 200): Promise<MessageDto[]> {
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      include: { decision: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })
    const authorIds = [...new Set(messages.map((m) => m.authorId).filter((id): id is string => !!id))]
    const authors = new Map(
      (await this.prisma.user.findMany({ where: { id: { in: authorIds } } })).map((u) => [u.id, u]),
    )
    return messages.map((m) => toMessageDto(m, authors))
  }

  /** Últimas mensagens em ordem cronológica, para o contexto do agent. */
  recentMessages(conversationId: string, take: number) {
    return this.prisma.message
      .findMany({ where: { conversationId }, orderBy: { createdAt: 'desc' }, take, include: { decision: true } })
      .then((messages) => messages.reverse())
  }

  async addMessage(conversation: Conversation, input: NewMessage): Promise<MessageDto> {
    const now = new Date()
    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: input.role,
        content: input.content,
        authorId: input.authorId,
        parts: input.parts ?? [],
        createdAt: now,
        decision: input.decision ? { create: { ...input.decision, conversationId: conversation.id } } : undefined,
      },
      include: { decision: true },
    })

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: now,
        ...(input.role === 'USER' && { userMessageCount: { increment: 1 } }),
        // Mensagens do funcionário enquanto aguarda/está com analista contam como não lidas no console
        ...(input.role === 'USER' && conversation.mode !== 'AGENT' && { unreadForAnalyst: { increment: 1 } }),
        ...(input.decision?.confidence != null && { lastConfidence: input.decision.confidence }),
        // A primeira mensagem do funcionário vira o título da conversa no histórico
        ...(input.role === 'USER' && !conversation.title && { title: toTitle(input.content) }),
      },
    })
    if (input.role === 'USER' && !conversation.title) conversation.title = toTitle(input.content)

    const authors = new Map<string, Awaited<ReturnType<typeof this.prisma.user.findUniqueOrThrow>>>()
    if (input.authorId)
      authors.set(input.authorId, await this.prisma.user.findUniqueOrThrow({ where: { id: input.authorId } }))
    const dto = toMessageDto(message, authors)
    this.realtime.messageCreated(conversation.employeeId, dto)
    await this.publishSummary(conversation.id)
    return dto
  }

  /** Substitui os blocos de uma mensagem (ex.: rascunho confirmado) e notifica. */
  async updateMessageParts(messageId: string, update: (parts: MessagePart[]) => MessagePart[]) {
    const message = await this.prisma.message.findUniqueOrThrow({ where: { id: messageId } })
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { parts: update(message.parts as MessagePart[]) },
      include: { decision: true, conversation: true },
    })
    this.realtime.messageUpdated(updated.conversation.employeeId, toMessageDto(updated))
  }

  async update(id: string, data: Prisma.ConversationUncheckedUpdateInput) {
    const conversation = await this.prisma.conversation.update({ where: { id }, data })
    await this.publishSummary(id)
    return conversation
  }

  async summary(id: string) {
    const conversation = await this.prisma.conversation.findUniqueOrThrow({
      where: { id },
      include: conversationInclude,
    })
    return toConversationDto(conversation, { online: this.realtime.isOnline(conversation.employeeId) })
  }

  async publishSummary(id: string) {
    this.realtime.conversationUpdated(await this.summary(id))
  }

  /** Lista do console: conversas recentes, encerradas apenas das últimas 48 h. */
  async listForAnalysts() {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        OR: [{ mode: { not: 'CLOSED' } }, { closedAt: { gte: new Date(Date.now() - 48 * 3_600_000) } }],
        messages: { some: {} },
      },
      include: conversationInclude,
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    })
    return conversations.map((c) => toConversationDto(c, { online: this.realtime.isOnline(c.employeeId) }))
  }

  assertAnalyst(user: AuthUser) {
    if (user.role !== 'ANALYST') throw new ForbiddenException('Acesso restrito aos analistas.')
  }
}

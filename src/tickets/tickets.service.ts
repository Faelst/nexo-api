import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma, Ticket, TicketCategory, TicketType } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { REOPEN_WINDOW_DAYS } from '../service-desk/labels'
import { computeDueAt } from '../service-desk/sla'
import type { CreateTicketDto } from './dto/create-ticket.dto'
import type { UpdateTicketDto } from './dto/update-ticket.dto'
import { LegacySystem } from './legacy-system'
import { toTicketDto } from './ticket.mapper'

const OPEN_STATUSES = ['ABERTO', 'EM_ANDAMENTO', 'AGUARDANDO_ANALISTA', 'APROVADO'] as const
const DAY_MS = 86_400_000

/** Palavras significativas de um texto, para a checagem simples de duplicidade. */
function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  )
}

/**
 * Serviço de chamados simulado, separado do agent. Toda operação passa pelo "sistema legado",
 * que pode falhar. Todas as consultas de funcionário são restritas aos chamados dele (privacidade).
 */
@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly legacy: LegacySystem,
  ) {}

  listForRequester(requesterId: string, scope: 'open' | 'all' = 'open') {
    return this.legacy.call('listar chamados', async () => {
      const where: Prisma.TicketWhereInput = { requesterId }
      if (scope === 'open') {
        where.OR = [
          { status: { in: [...OPEN_STATUSES] } },
          // Resolvidos recentemente continuam relevantes (podem ser reabertos)
          { status: 'RESOLVIDO', resolvedAt: { gte: new Date(Date.now() - REOPEN_WINDOW_DAYS * DAY_MS) } },
        ]
      }
      const tickets = await this.prisma.ticket.findMany({ where, orderBy: { updatedAt: 'desc' } })
      return tickets.map((t) => toTicketDto(t))
    })
  }

  /** Mesmo erro para "não existe" e "é de outra pessoa": não revela a existência do chamado. */
  getForRequester(requesterId: string, number: string) {
    return this.legacy.call('consultar chamado', async () => {
      const ticket = await this.findOwned(requesterId, number)
      const updates = await this.prisma.ticketUpdate.findMany({
        where: { ticketId: ticket.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
      })
      return {
        ...toTicketDto(ticket),
        updates: updates.map((u) => ({ author: u.author, message: u.message, createdAt: u.createdAt.toISOString() })),
      }
    })
  }

  /** Chamados abertos (ou resolvidos há até 7 dias) da mesma categoria com título parecido. */
  async findPossibleDuplicates(requesterId: string, category: TicketCategory, title: string, description: string) {
    const candidates = await this.prisma.ticket.findMany({
      where: {
        requesterId,
        category,
        OR: [
          { status: { in: [...OPEN_STATUSES] } },
          { status: 'RESOLVIDO', resolvedAt: { gte: new Date(Date.now() - REOPEN_WINDOW_DAYS * DAY_MS) } },
        ],
      },
    })
    const words = keywords(`${title} ${description}`)
    return candidates
      .map((t) => {
        const other = keywords(`${t.title} ${t.description}`)
        const shared = [...words].filter((w) => other.has(w)).length
        return { ticket: t, score: shared / Math.max(1, Math.min(words.size, other.size)) }
      })
      .filter((c) => c.score >= 0.3)
      .sort((a, b) => b.score - a.score)
      .map((c) => toTicketDto(c.ticket))
  }

  create(requesterId: string, input: CreateTicketDto, author = 'Nexo Assist') {
    return this.legacy.call('criar chamado', async () => {
      const ticket = await this.prisma.$transaction(async (tx) => {
        const number = await this.nextNumber(tx, input.type)
        const now = new Date()
        return tx.ticket.create({
          data: {
            ...input,
            number,
            requesterId,
            status: 'ABERTO',
            dueAt: computeDueAt(input.priority, now),
            updates: { create: { author, message: 'Chamado aberto pelo chat.' } },
          },
        })
      })
      return toTicketDto(ticket)
    })
  }

  update(requesterId: string, number: string, input: UpdateTicketDto, author = 'Nexo Assist') {
    return this.legacy.call('atualizar chamado', async () => {
      const ticket = await this.findOwned(requesterId, number)
      const now = new Date()
      const data: Prisma.TicketUpdateInput = { updatedAt: now }

      if (ticket.status === 'RESOLVIDO') {
        if (!input.reopen)
          throw new BadRequestException(`O ${number} está resolvido. Para complementar, reabra o chamado.`)
        const resolvedDaysAgo = (now.getTime() - (ticket.resolvedAt ?? now).getTime()) / DAY_MS
        if (resolvedDaysAgo > REOPEN_WINDOW_DAYS) {
          throw new BadRequestException(
            `O ${number} foi resolvido há mais de ${REOPEN_WINDOW_DAYS} dias e não pode ser reaberto. Abra um novo chamado.`,
          )
        }
        data.status = 'ABERTO'
        data.resolvedAt = null
      }

      const priority = input.priority ?? ticket.priority
      if (input.priority) data.priority = input.priority
      // O prazo vale para cada atualização
      data.dueAt = computeDueAt(priority, now)
      data.updates = { create: { author, message: input.comment } }

      const updated = await this.prisma.ticket.update({ where: { id: ticket.id }, data })
      return toTicketDto(updated)
    })
  }

  /** Marca o chamado como aguardando analista (transferência). */
  markWaitingAnalyst(requesterId: string, number: string, summary: string) {
    return this.legacy.call('transferir chamado', async () => {
      const ticket = await this.findOwned(requesterId, number)
      const updated = await this.prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          status: ticket.status === 'RESOLVIDO' ? ticket.status : 'AGUARDANDO_ANALISTA',
          updates: { create: { author: 'Nexo Assist', message: `Transferido para analista. ${summary}` } },
        },
      })
      return toTicketDto(updated)
    })
  }

  /** Visão do analista: todos os chamados de um funcionário (sem passar pelo legado instável). */
  async listForAnalyst(employeeId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { requesterId: employeeId },
      orderBy: { updatedAt: 'desc' },
    })
    const dtos = tickets.map((t) => toTicketDto(t))
    return {
      open: dtos.filter((t) => t.status !== 'RESOLVIDO'),
      closed: dtos.filter((t) => t.status === 'RESOLVIDO'),
    }
  }

  /** Analista assumiu: conta como resposta, então o prazo (SLA) recomeça a partir de agora. */
  async markInProgress(ticketId: string, analystName: string) {
    const ticket = await this.prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })
    if (ticket.status === 'RESOLVIDO') return
    const now = new Date()
    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        status: 'EM_ANDAMENTO',
        updatedAt: now,
        dueAt: computeDueAt(ticket.priority, now),
        updates: { create: { author: analystName, message: 'Analista assumiu o atendimento.' } },
      },
    })
  }

  private async findOwned(requesterId: string, number: string): Promise<Ticket> {
    const ticket = await this.prisma.ticket.findUnique({ where: { number: number.toUpperCase() } })
    if (!ticket || ticket.requesterId !== requesterId) throw new NotFoundException(`Chamado ${number} não encontrado.`)
    return ticket
  }

  private async nextNumber(tx: Prisma.TransactionClient, type: TicketType): Promise<string> {
    const counter = await tx.ticketCounter.upsert({
      where: { type },
      create: { type, value: type === 'INC' ? 20500 : 10500 },
      update: { value: { increment: 1 } },
    })
    return `${type}-${counter.value}`
  }
}

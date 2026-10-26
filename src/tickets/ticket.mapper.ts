import type { Ticket, TicketStatus } from '@prisma/client'
import { AFFECTED_LABEL, CATEGORY_LABEL, PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from '../service-desk/labels'
import { formatBrt, isOverdue } from '../service-desk/sla'

export type Tone = 'warning' | 'primary' | 'cta' | 'success' | 'danger' | 'neutral'

const STATUS_TONE: Record<TicketStatus, Tone> = {
  ABERTO: 'primary',
  EM_ANDAMENTO: 'primary',
  AGUARDANDO_ANALISTA: 'warning',
  APROVADO: 'success',
  RESOLVIDO: 'neutral',
}

/** Representação pública de um chamado (API e ferramentas do agent). */
export function toTicketDto(ticket: Ticket, now: Date = new Date()) {
  const overdue = isOverdue(ticket, now)
  return {
    number: ticket.number,
    type: ticket.type,
    typeLabel: TYPE_LABEL[ticket.type],
    title: ticket.title,
    description: ticket.description,
    category: ticket.category,
    categoryLabel: CATEGORY_LABEL[ticket.category],
    priority: ticket.priority,
    priorityLabel: PRIORITY_LABEL[ticket.priority],
    status: ticket.status,
    statusLabel: STATUS_LABEL[ticket.status],
    tone: overdue ? ('danger' as Tone) : STATUS_TONE[ticket.status],
    affected: ticket.affected,
    affectedLabel: AFFECTED_LABEL[ticket.affected],
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    dueAt: ticket.dueAt.toISOString(),
    dueLabel: formatBrt(ticket.dueAt, now),
    overdue,
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
  }
}

export type TicketDto = ReturnType<typeof toTicketDto>

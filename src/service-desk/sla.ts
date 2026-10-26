import type { Priority } from '@prisma/client'

/**
 * Regras de prazo do Anexo A. Horário do service desk: seg–sex, 8h–18h (horário de Brasília, UTC−3).
 * Prioridade crítica tem plantão 24h, então o prazo corre em horas corridas.
 */
const BRT_OFFSET_MS = -3 * 60 * 60 * 1000
const OPEN_HOUR = 8
const CLOSE_HOUR = 18
const BUSINESS_HOURS_PER_DAY = CLOSE_HOUR - OPEN_HOUR
const HOUR_MS = 60 * 60 * 1000

export const SLA_RULES: Record<Priority, { label: string; when: string; deadline: string }> = {
  CRITICA: { label: 'Crítica', when: 'Algo parado para uma equipe ou para a empresa', deadline: '1 hora' },
  ALTA: {
    label: 'Alta',
    when: 'Impede uma pessoa de trabalhar, ou há um compromisso no mesmo dia',
    deadline: '4 horas úteis',
  },
  MEDIA: { label: 'Média', when: 'Atrapalha, mas há alternativa', deadline: '3 dias úteis' },
  BAIXA: { label: 'Baixa', when: 'Pedidos e melhorias sem urgência', deadline: '5 dias úteis' },
}

/** Converte para um Date cujos campos UTC representam o relógio de Brasília. */
const toBrt = (d: Date) => new Date(d.getTime() + BRT_OFFSET_MS)
const fromBrt = (d: Date) => new Date(d.getTime() - BRT_OFFSET_MS)

const isWeekend = (brt: Date) => brt.getUTCDay() === 0 || brt.getUTCDay() === 6

/** Avança até o próximo instante dentro do horário útil (ou mantém, se já estiver dentro). */
function clampToBusinessTime(brt: Date): Date {
  const d = new Date(brt)
  for (;;) {
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60
    if (isWeekend(d) || hour >= CLOSE_HOUR) {
      d.setUTCDate(d.getUTCDate() + 1)
      d.setUTCHours(OPEN_HOUR, 0, 0, 0)
      continue
    }
    if (hour < OPEN_HOUR) d.setUTCHours(OPEN_HOUR, 0, 0, 0)
    return d
  }
}

/** Soma horas úteis a partir de `start`. */
export function addBusinessHours(start: Date, hours: number): Date {
  let cursor = clampToBusinessTime(toBrt(start))
  let remainingMs = hours * HOUR_MS

  while (remainingMs > 0) {
    const endOfDay = new Date(cursor)
    endOfDay.setUTCHours(CLOSE_HOUR, 0, 0, 0)
    const available = endOfDay.getTime() - cursor.getTime()
    if (remainingMs <= available) {
      cursor = new Date(cursor.getTime() + remainingMs)
      remainingMs = 0
    } else {
      remainingMs -= available
      cursor = clampToBusinessTime(endOfDay)
    }
  }
  return fromBrt(cursor)
}

/** Prazo da próxima resposta/atualização de um chamado. */
export function computeDueAt(priority: Priority, from: Date = new Date()): Date {
  switch (priority) {
    case 'CRITICA':
      return new Date(from.getTime() + HOUR_MS)
    case 'ALTA':
      return addBusinessHours(from, 4)
    case 'MEDIA':
      return addBusinessHours(from, 3 * BUSINESS_HOURS_PER_DAY)
    case 'BAIXA':
      return addBusinessHours(from, 5 * BUSINESS_HOURS_PER_DAY)
  }
}

export function isOverdue(ticket: { dueAt: Date; status: string }, now: Date = new Date()): boolean {
  return ticket.status !== 'RESOLVIDO' && ticket.status !== 'APROVADO' && ticket.dueAt.getTime() < now.getTime()
}

/** Formata um horário no fuso de Brasília (ex.: "13:43" ou "28 out, 13:43"). */
export function formatBrt(date: Date, now: Date = new Date()): string {
  const d = toBrt(date)
  const n = toBrt(now)
  const hhmm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  const sameDay = d.toISOString().slice(0, 10) === n.toISOString().slice(0, 10)
  if (sameDay) return hhmm
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]}, ${hhmm}`
}

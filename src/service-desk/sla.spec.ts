import { addBusinessHours, computeDueAt, isOverdue } from './sla'

/** Cria uma data a partir do horário de Brasília (UTC−3). */
const brt = (iso: string) => new Date(`${iso}-03:00`)

describe('SLA do service desk', () => {
  it('soma horas úteis dentro do mesmo dia', () => {
    // segunda 27/10/2025 10h + 4h úteis = 14h
    expect(addBusinessHours(brt('2025-10-27T10:00:00'), 4)).toEqual(brt('2025-10-27T14:00:00'))
  })

  it('passa para o dia seguinte quando o expediente acaba', () => {
    // segunda 16h + 4h úteis = 2h na segunda + 2h na terça → terça 10h
    expect(addBusinessHours(brt('2025-10-27T16:00:00'), 4)).toEqual(brt('2025-10-28T10:00:00'))
  })

  it('pula o fim de semana', () => {
    // sexta 17h + 4h úteis = 1h na sexta + 3h na segunda → segunda 11h
    expect(addBusinessHours(brt('2025-10-31T17:00:00'), 4)).toEqual(brt('2025-11-03T11:00:00'))
  })

  it('começa a contar no início do expediente quando aberto fora do horário', () => {
    // sábado 22h → conta a partir de segunda 8h
    expect(addBusinessHours(brt('2025-11-01T22:00:00'), 4)).toEqual(brt('2025-11-03T12:00:00'))
  })

  it('crítica usa 1 hora corrida (plantão 24h)', () => {
    expect(computeDueAt('CRITICA', brt('2025-11-01T22:00:00'))).toEqual(brt('2025-11-01T23:00:00'))
  })

  it('média vence em 3 dias úteis', () => {
    // segunda 10h + 30h úteis → quinta 10h
    expect(computeDueAt('MEDIA', brt('2025-10-27T10:00:00'))).toEqual(brt('2025-10-30T10:00:00'))
  })

  it('chamado resolvido nunca está vencido', () => {
    const past = brt('2025-01-01T10:00:00')
    expect(isOverdue({ dueAt: past, status: 'RESOLVIDO' })).toBe(false)
    expect(isOverdue({ dueAt: past, status: 'ABERTO' })).toBe(true)
  })
})

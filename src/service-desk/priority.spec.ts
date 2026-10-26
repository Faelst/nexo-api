import { priorityFor } from './priority'

describe('prioridade (impacto × urgência)', () => {
  it('parado para uma equipe ou para a empresa é crítica', () => {
    expect(priorityFor('EQUIPE', 'PARADO')).toBe('CRITICA')
    expect(priorityFor('EMPRESA', 'PARADO')).toBe('CRITICA')
  })

  it('uma pessoa impedida de trabalhar (ou com compromisso hoje) é alta, não crítica', () => {
    expect(priorityFor('SOMENTE_EU', 'PARADO')).toBe('ALTA')
    expect(priorityFor('NAO_SEI', 'PARADO')).toBe('ALTA')
  })

  it('com alternativa é média, mesmo para a equipe', () => {
    expect(priorityFor('SOMENTE_EU', 'ATRAPALHA')).toBe('MEDIA')
    expect(priorityFor('EQUIPE', 'ATRAPALHA')).toBe('MEDIA')
  })

  it('sem urgência é baixa', () => {
    expect(priorityFor('EMPRESA', 'SEM_URGENCIA')).toBe('BAIXA')
  })
})

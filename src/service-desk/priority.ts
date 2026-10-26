import type { Affected, Priority } from '@prisma/client'

/** Urgência descrita pelo funcionário (o que acontece se não resolver agora). */
export type Urgency = 'PARADO' | 'ATRAPALHA' | 'SEM_URGENCIA'

export const URGENCY_LABEL: Record<Urgency, string> = {
  PARADO: 'impede de trabalhar ou há compromisso hoje',
  ATRAPALHA: 'atrapalha, mas há alternativa',
  SEM_URGENCIA: 'pedido ou melhoria sem urgência',
}

/**
 * Prioridade do Anexo A = impacto (quantas pessoas) × urgência (compromisso em risco):
 * - Crítica: algo parado para uma equipe ou para a empresa
 * - Alta: impede uma pessoa de trabalhar, ou há um compromisso no mesmo dia
 * - Média: atrapalha, mas há alternativa
 * - Baixa: pedidos e melhorias sem urgência
 */
export function priorityFor(affected: Affected, urgency: Urgency): Priority {
  if (urgency === 'SEM_URGENCIA') return 'BAIXA'
  if (urgency === 'ATRAPALHA') return 'MEDIA'
  return affected === 'EQUIPE' || affected === 'EMPRESA' ? 'CRITICA' : 'ALTA'
}

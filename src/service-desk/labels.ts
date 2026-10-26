import type { Affected, Priority, TicketCategory, TicketStatus, TicketType } from '@prisma/client'

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  ACESSO: 'Acesso',
  REDE_VPN: 'Rede e VPN',
  HARDWARE: 'Hardware',
  SOFTWARE: 'Software',
  EMAIL: 'E-mail',
  OUTROS: 'Outros',
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  CRITICA: 'Crítica',
  ALTA: 'Alta',
  MEDIA: 'Média',
  BAIXA: 'Baixa',
}

export const STATUS_LABEL: Record<TicketStatus, string> = {
  ABERTO: 'Aberto',
  EM_ANDAMENTO: 'Em andamento',
  AGUARDANDO_ANALISTA: 'Aguardando analista',
  APROVADO: 'Aprovado',
  RESOLVIDO: 'Resolvido',
}

export const AFFECTED_LABEL: Record<Affected, string> = {
  SOMENTE_EU: 'Somente você',
  EQUIPE: 'Sua equipe',
  EMPRESA: 'Toda a empresa',
  NAO_SEI: 'Não informado',
}

export const TYPE_LABEL: Record<TicketType, string> = {
  INC: 'Incidente',
  REQ: 'Requisição',
}

/** Chamados resolvidos há até 7 dias podem ser reabertos (Anexo A). */
export const REOPEN_WINDOW_DAYS = 7

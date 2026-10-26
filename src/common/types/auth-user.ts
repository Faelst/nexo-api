import type { Role } from '@prisma/client'

/** Usuário autenticado extraído do JWT. */
export type AuthUser = {
  id: string
  email: string
  name: string
  role: Role
}

export type JwtPayload = {
  sub: string
  email: string
  name: string
  role: Role
}

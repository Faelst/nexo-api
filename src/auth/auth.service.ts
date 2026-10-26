import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { User } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { JwtPayload } from '../common/types/auth-user'
import type { LoginDto } from './dto/login.dto'

export function toUserDto(user: User) {
  const initials = user.name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const passwordChangedDaysAgo = Math.floor((Date.now() - user.passwordChangedAt.getTime()) / 86_400_000)
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    initials,
    role: user.role,
    department: user.department,
    team: user.team,
    passwordChangedDaysAgo,
  }
}

export type UserDto = ReturnType<typeof toUserDto>

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Conforme o PRD, aceita os funcionários dos dados de exemplo com qualquer senha.
   * Em produção isto seria substituído pelo SSO/AD corporativo.
   */
  async login({ email }: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email } })
    if (!user) throw new UnauthorizedException('E-mail não encontrado entre os funcionários da Nexo.')

    const payload: JwtPayload = { sub: user.id, email: user.email, name: user.name, role: user.role }
    return { accessToken: await this.jwt.signAsync(payload), user: toUserDto(user) }
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new NotFoundException('Usuário não encontrado.')
    return toUserDto(user)
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    return this.jwt.verifyAsync<JwtPayload>(token)
  }
}

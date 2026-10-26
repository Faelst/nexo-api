import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Role } from '@prisma/client'
import { ROLES_KEY } from '../decorators/roles.decorator'
import type { AuthUser } from '../types/auth-user'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!roles?.length) return true
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user
    if (!user || !roles.includes(user.role)) throw new ForbiddenException('Acesso restrito.')
    return true
  }
}

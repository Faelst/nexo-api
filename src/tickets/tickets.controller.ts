import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import type { AuthUser } from '../common/types/auth-user'
import { ListTicketsQuery } from './dto/list-tickets.query'
import { withLegacyRetry } from './legacy-system'
import { TicketsService } from './tickets.service'

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get('tickets')
  @Roles('EMPLOYEE')
  list(@CurrentUser() user: AuthUser, @Query() query: ListTicketsQuery) {
    return withLegacyRetry(() => this.tickets.listForRequester(user.id, query.scope))
  }

  @Get('tickets/:number')
  @Roles('EMPLOYEE')
  get(@CurrentUser() user: AuthUser, @Param('number') number: string) {
    return withLegacyRetry(() => this.tickets.getForRequester(user.id, number))
  }

  @Get('analyst/employees/:employeeId/tickets')
  @Roles('ANALYST')
  listForEmployee(@Param('employeeId') employeeId: string) {
    return this.tickets.listForAnalyst(employeeId)
  }
}

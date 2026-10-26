import { Module } from '@nestjs/common'
import { LegacySystem } from './legacy-system'
import { TicketsController } from './tickets.controller'
import { TicketsService } from './tickets.service'

@Module({
  controllers: [TicketsController],
  providers: [TicketsService, LegacySystem],
  exports: [TicketsService],
})
export class TicketsModule {}

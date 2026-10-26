import { Module } from '@nestjs/common'
import { AgentModule } from '../agent/agent.module'
import { AuthModule } from '../auth/auth.module'
import { ConversationsModule } from '../conversations/conversations.module'
import { TicketsModule } from '../tickets/tickets.module'
import { AnalystService } from './analyst.service'
import { AnalystController, ChatController } from './chat.controller'
import { ChatGateway } from './chat.gateway'
import { ChatService } from './chat.service'

@Module({
  imports: [AuthModule, ConversationsModule, AgentModule, TicketsModule],
  controllers: [ChatController, AnalystController],
  providers: [ChatService, AnalystService, ChatGateway],
})
export class ChatModule {}

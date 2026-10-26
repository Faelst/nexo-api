import { Module } from '@nestjs/common'
import { ConversationsModule } from '../conversations/conversations.module'
import { KnowledgeModule } from '../knowledge/knowledge.module'
import { TicketsModule } from '../tickets/tickets.module'
import { AgentService } from './agent.service'

@Module({
  imports: [ConversationsModule, TicketsModule, KnowledgeModule],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}

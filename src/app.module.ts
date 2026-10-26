import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AgentModule } from './agent/agent.module'
import { AuthModule } from './auth/auth.module'
import { ChatModule } from './chat/chat.module'
import { validateEnv } from './config/env.validation'
import { ConversationsModule } from './conversations/conversations.module'
import { KnowledgeModule } from './knowledge/knowledge.module'
import { PrismaModule } from './prisma/prisma.module'
import { RealtimeModule } from './realtime/realtime.module'
import { TicketsModule } from './tickets/tickets.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    RealtimeModule,
    AuthModule,
    TicketsModule,
    KnowledgeModule,
    ConversationsModule,
    AgentModule,
    ChatModule,
  ],
})
export class AppModule {}

import { Injectable } from '@nestjs/common'
import type { Server } from 'socket.io'
import type { ConversationDto, MessageDto } from '../conversations/conversation.mapper'

export const rooms = {
  user: (userId: string) => `user:${userId}`,
  analysts: 'analysts',
}

export type AgentStatusEvent = { conversationId: string; status: 'thinking' | 'idle'; step?: string }

/**
 * Ponto único de emissão de eventos em tempo real. O gateway registra o servidor Socket.IO aqui,
 * e os serviços de domínio emitem sem depender do gateway.
 */
@Injectable()
export class RealtimeService {
  private server: Server | null = null
  private readonly connections = new Map<string, number>()

  bind(server: Server) {
    this.server = server
  }

  /* ---------- Presença ---------- */

  connected(userId: string) {
    this.connections.set(userId, (this.connections.get(userId) ?? 0) + 1)
  }

  disconnected(userId: string) {
    const count = (this.connections.get(userId) ?? 1) - 1
    if (count <= 0) this.connections.delete(userId)
    else this.connections.set(userId, count)
  }

  isOnline(userId: string) {
    return this.connections.has(userId)
  }

  /* ---------- Eventos ---------- */

  /** Nova mensagem: vai para o funcionário dono da conversa e para o console dos analistas. */
  messageCreated(employeeId: string, message: MessageDto) {
    this.server?.to([rooms.user(employeeId), rooms.analysts]).emit('message:new', message)
  }

  messageUpdated(employeeId: string, message: MessageDto) {
    this.server?.to([rooms.user(employeeId), rooms.analysts]).emit('message:updated', message)
  }

  agentStatus(employeeId: string, event: AgentStatusEvent) {
    this.server?.to([rooms.user(employeeId), rooms.analysts]).emit('agent:status', event)
  }

  conversationUpdated(conversation: ConversationDto) {
    this.server?.to([rooms.user(conversation.employee.id), rooms.analysts]).emit('conversation:updated', conversation)
  }
}

import { HttpException, Logger } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets'
import type { DefaultEventsMap, Server, Socket } from 'socket.io'
import { AuthService } from '../auth/auth.service'
import type { AuthUser } from '../common/types/auth-user'
import { RealtimeService, rooms } from '../realtime/realtime.service'
import { ChatService } from './chat.service'
import { ConfirmDraftDto, DraftActionDto } from './dto/draft-action.dto'
import { ChatSendDto } from './dto/send-message.dto'
import { validatePayload } from './validate-payload'

type Ack<T = unknown> = { ok: true; data?: T } | { ok: false; error: string }
type AuthedSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, { user?: AuthUser }>

/** Converte exceções em resposta (ack) legível para o cliente. */
async function ack<T>(fn: () => Promise<T>): Promise<Ack<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    const message =
      error instanceof HttpException
        ? ((error.getResponse() as { message?: string | string[] }).message ?? error.message)
        : 'Não foi possível concluir a ação.'
    return { ok: false, error: Array.isArray(message) ? message[0] : message }
  }
}

/**
 * Gateway Socket.IO. Autentica pelo JWT do handshake; funcionários entram na sala própria
 * e analistas na sala do console. CORS é configurado no adapter (main.ts).
 */
@WebSocketGateway()
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name)

  constructor(
    private readonly auth: AuthService,
    private readonly realtime: RealtimeService,
    private readonly chat: ChatService,
  ) {}

  afterInit(server: Server) {
    this.realtime.bind(server)
  }

  async handleConnection(socket: AuthedSocket) {
    try {
      const token = (socket.handshake.auth as { token?: string }).token
      if (!token) throw new Error('sem token')
      const payload = await this.auth.verifyToken(token)
      const user: AuthUser = { id: payload.sub, email: payload.email, name: payload.name, role: payload.role }
      socket.data.user = user
      await socket.join(user.role === 'ANALYST' ? rooms.analysts : rooms.user(user.id))
      this.realtime.connected(user.id)
    } catch {
      socket.emit('auth:error', { error: 'Sessão inválida ou expirada.' })
      socket.disconnect(true)
    }
  }

  handleDisconnect(socket: AuthedSocket) {
    if (socket.data.user) this.realtime.disconnected(socket.data.user.id)
  }

  @SubscribeMessage('chat:send')
  send(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown) {
    return ack(async () => {
      const user = this.employee(socket)
      const dto = await validatePayload(ChatSendDto, body)
      return this.chat.send(user, dto.conversationId, dto.text)
    })
  }

  @SubscribeMessage('draft:confirm')
  confirm(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown) {
    return ack(async () => this.chat.confirmDraft(this.employee(socket), await validatePayload(ConfirmDraftDto, body)))
  }

  @SubscribeMessage('draft:cancel')
  cancel(@ConnectedSocket() socket: AuthedSocket, @MessageBody() body: unknown) {
    return ack(async () => {
      const dto = await validatePayload(DraftActionDto, body)
      await this.chat.cancelDraft(this.employee(socket), dto.draftId)
    })
  }

  private employee(socket: AuthedSocket): AuthUser {
    const user = socket.data.user
    if (!user || user.role !== 'EMPLOYEE') {
      this.logger.warn('Evento de funcionário recebido de socket não autorizado')
      throw new HttpException('Ação disponível apenas para funcionários.', 403)
    }
    return user
  }
}

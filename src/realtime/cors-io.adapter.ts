import type { INestApplicationContext } from '@nestjs/common'
import { IoAdapter } from '@nestjs/platform-socket.io'
import type { Server, ServerOptions } from 'socket.io'

/** Adapter Socket.IO com CORS vindo da configuração (o decorator do gateway não lê o .env). */
export class CorsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly origin: string,
  ) {
    super(app)
  }

  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, { ...options, cors: { origin: this.origin, credentials: true } }) as Server
  }
}

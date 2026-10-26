import { Logger, ValidationPipe } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { CorsIoAdapter } from './realtime/cors-io.adapter'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  const config = app.get(ConfigService)
  const origin = config.get<string>('FRONTEND_URL', 'http://localhost:3000')

  app.enableCors({ origin, credentials: true })
  app.useWebSocketAdapter(new CorsIoAdapter(app, origin))
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  app.enableShutdownHooks()

  const port = config.get<number>('PORT', 3333)
  await app.listen(port)
  Logger.log(`API em http://localhost:${port} · CORS ${origin}`, 'Bootstrap')
}

void bootstrap()

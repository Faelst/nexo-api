import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import type { AuthUser } from '../common/types/auth-user'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto)
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id)
  }

  /** Simulado: em produção dispararia o fluxo de redefinição do AD. */
  @Post('password-reset')
  @HttpCode(202)
  @UseGuards(JwtAuthGuard)
  async passwordReset(@CurrentUser() user: AuthUser) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    return { sentTo: user.email }
  }
}

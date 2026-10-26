import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import type { AuthUser } from '../common/types/auth-user'
import { AnalystService } from './analyst.service'
import { ChatService } from './chat.service'
import { ConfirmDraftDto } from './dto/draft-action.dto'
import { ChatSendDto, SendMessageDto } from './dto/send-message.dto'

/** Funcionário. Envio de mensagens também existe via socket (`chat:send`); REST serve de alternativa. */
@Controller('chat')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('EMPLOYEE')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('current')
  current(@CurrentUser() user: AuthUser) {
    return this.chat.current(user)
  }

  @Get('conversations')
  list(@CurrentUser() user: AuthUser) {
    return this.chat.list(user)
  }

  @Get('conversations/:id')
  open(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.open(user, id)
  }

  @Post('conversations')
  startNew(@CurrentUser() user: AuthUser) {
    return this.chat.startNew(user)
  }

  @Post('messages')
  send(@CurrentUser() user: AuthUser, @Body() dto: ChatSendDto) {
    return this.chat.send(user, dto.conversationId, dto.text)
  }

  @Post('drafts/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() user: AuthUser, @Body() dto: ConfirmDraftDto) {
    return this.chat.confirmDraft(user, dto)
  }

  @Post('drafts/:draftId/cancel')
  @HttpCode(204)
  cancel(@CurrentUser() user: AuthUser, @Param('draftId') draftId: string) {
    return this.chat.cancelDraft(user, draftId)
  }
}

@Controller('analyst/conversations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ANALYST')
export class AnalystController {
  constructor(private readonly analyst: AnalystService) {}

  @Get()
  list() {
    return this.analyst.list()
  }

  @Get(':id')
  messages(@Param('id') id: string) {
    return this.analyst.messages(id)
  }

  @Post(':id/read')
  @HttpCode(204)
  read(@Param('id') id: string) {
    return this.analyst.markRead(id)
  }

  @Post(':id/assume')
  @HttpCode(200)
  assume(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.analyst.assume(user, id)
  }

  @Post(':id/release')
  @HttpCode(200)
  release(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.analyst.release(user, id)
  }

  @Post(':id/close')
  @HttpCode(200)
  close(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.analyst.close(user, id)
  }

  @Post(':id/messages')
  send(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.analyst.send(user, id, dto.text)
  }
}

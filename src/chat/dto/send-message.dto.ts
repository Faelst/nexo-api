import { Transform } from 'class-transformer'
import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class SendMessageDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'A mensagem está vazia.' })
  @MaxLength(2000, { message: 'A mensagem pode ter no máximo 2000 caracteres.' })
  text!: string
}

/** Mensagem do funcionário: informa em qual das conversas dele está escrevendo. */
export class ChatSendDto extends SendMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe a conversa.' })
  conversationId!: string
}

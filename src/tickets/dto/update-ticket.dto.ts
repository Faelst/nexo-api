import { Priority } from '@prisma/client'
import { IsBoolean, IsEnum, IsOptional, IsString, Length } from 'class-validator'

export class UpdateTicketDto {
  @IsString()
  @Length(3, 2000)
  comment!: string

  @IsEnum(Priority)
  @IsOptional()
  priority?: Priority

  /** Reabre um chamado resolvido (permitido até 7 dias após a resolução). */
  @IsBoolean()
  @IsOptional()
  reopen?: boolean
}

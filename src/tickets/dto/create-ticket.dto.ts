import { Affected, Priority, TicketCategory, TicketType } from '@prisma/client'
import { IsEnum, IsString, Length } from 'class-validator'

export class CreateTicketDto {
  @IsEnum(TicketType)
  type!: TicketType

  @IsString()
  @Length(5, 120)
  title!: string

  @IsString()
  @Length(10, 2000)
  description!: string

  @IsEnum(TicketCategory)
  category!: TicketCategory

  @IsEnum(Priority)
  priority!: Priority

  @IsEnum(Affected)
  affected!: Affected
}

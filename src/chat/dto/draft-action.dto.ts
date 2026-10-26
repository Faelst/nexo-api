import { Transform } from 'class-transformer'
import { IsNotEmpty, IsOptional, IsString, Length } from 'class-validator'

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)

export class DraftActionDto {
  @IsString()
  @IsNotEmpty()
  draftId!: string
}

/** Confirmação do rascunho, opcionalmente com título/descrição editados pelo funcionário. */
export class ConfirmDraftDto extends DraftActionDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(5, 120, { message: 'O título deve ter entre 5 e 120 caracteres.' })
  title?: string

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(10, 1500, { message: 'A descrição deve ter entre 10 e 1500 caracteres.' })
  description?: string
}

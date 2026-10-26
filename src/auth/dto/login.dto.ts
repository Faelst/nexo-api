import { Transform } from 'class-transformer'
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator'

export class LoginDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @Matches(/@nexo\.com\.br$/, { message: 'Use seu e-mail corporativo (@nexo.com.br).' })
  email!: string

  @IsString()
  @IsNotEmpty({ message: 'Informe a senha.' })
  @MaxLength(128)
  password!: string
}

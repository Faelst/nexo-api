import { plainToInstance } from 'class-transformer'
import { IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUrl, Max, Min, validateSync } from 'class-validator'

/** Variáveis de ambiente validadas na inicialização: a API não sobe com configuração inválida. */
export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string

  @IsInt()
  @IsOptional()
  PORT: number = 3333

  @IsUrl({ require_tld: false })
  FRONTEND_URL: string = 'http://localhost:3000'

  @IsString()
  @IsNotEmpty()
  JWT_SECRET!: string

  @IsString()
  JWT_EXPIRES_IN: string = '8h'

  /**
   * Modelo no formato do roteador do Mastra (`provedor/modelo`). A chave do provedor correspondente
   * (OPENAI_API_KEY, ANTHROPIC_API_KEY…) é opcional para a API subir; sem ela o agent responde com erro amigável.
   */
  @IsString()
  LLM_MODEL: string = 'openai/gpt-4.1-mini'

  @IsString()
  @IsOptional()
  OPENAI_API_KEY?: string

  @IsString()
  @IsOptional()
  ANTHROPIC_API_KEY?: string

  @IsInt()
  @Min(1)
  MAX_SESSION_MESSAGES: number = 30

  @IsNumber()
  @Min(0)
  @Max(1)
  LEGACY_FAILURE_RATE: number = 0.08
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true })
  const errors = validateSync(validated, { skipMissingProperties: false })
  if (errors.length > 0) {
    const details = errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`).join('\n')
    throw new Error(`Configuração inválida:\n${details}`)
  }
  return validated
}

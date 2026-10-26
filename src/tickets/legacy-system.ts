import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

export class LegacyUnavailableError extends ServiceUnavailableException {
  constructor() {
    super('O sistema de chamados está temporariamente indisponível. Tente novamente em alguns segundos.')
  }
}

/**
 * Simula o sistema de chamados legado: latência variável e indisponibilidade ocasional
 * (taxa configurável em LEGACY_FAILURE_RATE). Quem consome decide como tentar de novo.
 */
@Injectable()
export class LegacySystem {
  private readonly logger = new Logger(LegacySystem.name)
  private readonly failureRate: number

  constructor(config: ConfigService) {
    this.failureRate = Number(config.get('LEGACY_FAILURE_RATE', 0.08))
  }

  async call<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    await new Promise((resolve) => setTimeout(resolve, 60 + Math.random() * 180))
    if (Math.random() < this.failureRate) {
      this.logger.warn(`Sistema legado indisponível em "${operation}"`)
      throw new LegacyUnavailableError()
    }
    return fn()
  }
}

/** Repete a operação quando o legado está indisponível (backoff curto), mantendo o erro final. */
export async function withLegacyRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 250): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (!(error instanceof LegacyUnavailableError)) throw error
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt))
    }
  }
  throw lastError
}

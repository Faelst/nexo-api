import { plainToInstance, type ClassConstructor } from 'class-transformer'
import { validate } from 'class-validator'
import { BadRequestException } from '@nestjs/common'

/** Valida payloads de eventos Socket.IO com os mesmos DTOs (class-validator) da API REST. */
export async function validatePayload<T extends object>(cls: ClassConstructor<T>, payload: unknown): Promise<T> {
  const instance = plainToInstance(cls, payload ?? {})
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true })
  if (errors.length) {
    const message = errors.flatMap((e) => Object.values(e.constraints ?? {}))[0] ?? 'Dados inválidos.'
    throw new BadRequestException(message)
  }
  return instance
}

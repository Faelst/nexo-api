import { IsIn, IsOptional } from 'class-validator'

export class ListTicketsQuery {
  @IsIn(['open', 'all'])
  @IsOptional()
  scope: 'open' | 'all' = 'open'
}

import { IsUUID } from 'class-validator';

export class RoutingPlanIdDto {
  @IsUUID('4')
  id!: string;
}

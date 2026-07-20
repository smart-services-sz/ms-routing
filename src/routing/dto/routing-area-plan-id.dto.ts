import { IsString } from 'class-validator';

export class RoutingAreaPlanIdDto {
  @IsString()
  id!: string;
}

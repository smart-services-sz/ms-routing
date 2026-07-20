import { IsOptional, IsString } from 'class-validator';

export class GetAssignedRouteDto {
  @IsString()
  crewId!: string;

  @IsOptional()
  @IsString()
  planningDate?: string;
}

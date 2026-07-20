import { IsOptional, IsString } from 'class-validator';

export class GetAssignedRouteDto {
  @IsOptional()
  @IsString()
  crewId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  planningDate?: string;
}

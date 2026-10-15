import { IsOptional, IsString } from 'class-validator';

import { RoutingMunicipalityScopeDto } from './routing-municipality-scope.dto';

export class GetAssignedRouteDto extends RoutingMunicipalityScopeDto {
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

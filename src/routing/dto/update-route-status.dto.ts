import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';

import { RoutingMunicipalityScopeDto } from './routing-municipality-scope.dto';

export class UpdateRouteStatusDto extends RoutingMunicipalityScopeDto {
  @IsUUID('4')
  routeId!: string;

  @IsIn(['assigned', 'in_progress', 'completed', 'cancelled'])
  status!: 'assigned' | 'in_progress' | 'completed' | 'cancelled';

  @IsOptional()
  @IsUUID('4')
  actorId?: string;

  @IsOptional()
  @IsBoolean()
  actorIsAdmin?: boolean;
}

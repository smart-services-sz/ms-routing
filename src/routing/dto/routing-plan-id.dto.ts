import { IsUUID } from 'class-validator';

import { RoutingMunicipalityScopeDto } from './routing-municipality-scope.dto';

export class RoutingPlanIdDto extends RoutingMunicipalityScopeDto {
  @IsUUID('4')
  id!: string;
}

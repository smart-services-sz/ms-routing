import { IsString } from 'class-validator';

import { RoutingMunicipalityScopeDto } from './routing-municipality-scope.dto';

export class RoutingAreaPlanIdDto extends RoutingMunicipalityScopeDto {
  @IsString()
  id!: string;
}

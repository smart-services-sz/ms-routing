import { Type } from 'class-transformer';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { CategoryRuleDto } from './category-rule.dto';
import { CrewRuleDto } from './crew-rule.dto';
import { ZoneRuleDto } from './zone-rule.dto';

import { RoutingMunicipalityScopeDto } from './routing-municipality-scope.dto';

export class UpsertRoutingRulesDto extends RoutingMunicipalityScopeDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryRuleDto)
  categoryRules!: CategoryRuleDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CrewRuleDto)
  crews!: CrewRuleDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ZoneRuleDto)
  zones?: ZoneRuleDto[];
}

import { IsDateString, IsInt, IsIn, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { RoutingMunicipalityScopeDto } from './routing-municipality-scope.dto';

export class RoutingMetricsDto extends RoutingMunicipalityScopeDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  rangeDays = 30;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([1, 7, 30])
  bucketDays: 1 | 7 | 30 = 7;
}
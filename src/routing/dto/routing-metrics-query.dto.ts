import { IsDateString, IsInt, IsIn, IsOptional, IsString, Max, MaxLength, Matches, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { RoutingMunicipalityScopeDto } from './routing-municipality-scope.dto';

export class RoutingMetricsQueryDto extends RoutingMunicipalityScopeDto {
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
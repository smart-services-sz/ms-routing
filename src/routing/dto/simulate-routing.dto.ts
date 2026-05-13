import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { UpsertRoutingRulesDto } from './upsert-routing-rules.dto';

export class SimulateRoutingDto {
  @IsOptional()
  @IsString()
  planningDate?: string;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(5000)
  maxFetch?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpsertRoutingRulesDto)
  overrideRules?: UpsertRoutingRulesDto;

  @IsOptional()
  @IsBoolean()
  persistPlan?: boolean;

  @IsOptional()
  @IsBoolean()
  useGoogleOptimization?: boolean;

  @IsOptional()
  @IsLatitude()
  originLat?: number;

  @IsOptional()
  @IsLongitude()
  originLng?: number;
}

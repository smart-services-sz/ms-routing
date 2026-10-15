import {
  IsArray,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

import { RoutingMunicipalityScopeDto } from './routing-municipality-scope.dto';

export class SaveRoutingAreaPlanDto extends RoutingMunicipalityScopeDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  name!: string;

  @IsString()
  userId!: string;

  @IsOptional()
  @IsString()
  userName?: string;

  @IsArray()
  @IsString({ each: true })
  categorias!: string[];

  @IsOptional()
  @IsString()
  originAddress?: string;

  @IsLatitude()
  originLat!: number;

  @IsLongitude()
  originLng!: number;

  @IsInt()
  @Min(1)
  @Max(20)
  dailyByUser!: number;

  @IsInt()
  @Min(1)
  @Max(20)
  dailyByCategory!: number;
}

import { IsLatitude, IsLongitude, IsOptional, IsString } from 'class-validator';

export class ZoneRuleDto {
  @IsString()
  id!: string;

  @IsOptional()
  @IsString()
  nombre?: string;

  @IsLatitude()
  minLat!: number;

  @IsLatitude()
  maxLat!: number;

  @IsLongitude()
  minLng!: number;

  @IsLongitude()
  maxLng!: number;
}

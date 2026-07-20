import { IsArray, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Max, Min } from 'class-validator';

export class SaveRoutingAreaPlanDto {
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
  @Max(1000)
  dailyByUser!: number;

  @IsInt()
  @Min(1)
  @Max(1000)
  dailyByCategory!: number;
}

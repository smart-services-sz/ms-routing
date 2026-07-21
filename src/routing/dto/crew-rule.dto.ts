import {
  IsArray,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CrewRuleDto {
  @IsOptional()
  @IsString()
  crewId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  userName?: string;

  @IsInt()
  @Min(1)
  @Max(20)
  maxReclamosDiarios!: number;

  @IsArray()
  @IsIn(
    [
      'agua_y_cloacas',
      'alumbrado',
      'baches_y_pavimento',
      'arbolado',
      'residuos',
      'electricidad',
      'gas',
      'transporte',
      'infraestructura',
      'otros',
    ],
    { each: true },
  )
  allowedCategorias!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedZoneIds?: string[];

  @IsOptional()
  @IsLatitude()
  startLat?: number;

  @IsOptional()
  @IsLongitude()
  startLng?: number;
}

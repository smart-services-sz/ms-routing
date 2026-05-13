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
  @IsString()
  crewId!: string;

  @IsOptional()
  @IsString()
  nombre?: string;

  @IsInt()
  @Min(1)
  @Max(1000)
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

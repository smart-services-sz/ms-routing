import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  Matches,
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
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  planningDate?: string;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(5000)
  maxFetch?: number;

  @IsOptional()
  @IsArray()
  @IsIn(['pendiente', 'en_proceso', 'resuelto', 'rechazado', 'cerrado'], {
    each: true,
  })
  claimStatuses?: Array<
    'pendiente' | 'en_proceso' | 'resuelto' | 'rechazado' | 'cerrado'
  >;

  @IsOptional()
  @IsArray()
  @IsIn(['alta', 'media', 'baja'], { each: true })
  priorities?: Array<'alta' | 'media' | 'baja'>;

  @IsOptional()
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
  categories?: Array<
    | 'agua_y_cloacas'
    | 'alumbrado'
    | 'baches_y_pavimento'
    | 'arbolado'
    | 'residuos'
    | 'electricidad'
    | 'gas'
    | 'transporte'
    | 'infraestructura'
    | 'otros'
  >;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)
  municipalityId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)
  areaId?: string;

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

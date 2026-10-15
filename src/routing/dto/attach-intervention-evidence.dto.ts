import {
  IsIn,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import { RoutingMunicipalityScopeDto } from './routing-municipality-scope.dto';

export class AttachInterventionEvidenceDto extends RoutingMunicipalityScopeDto {
  @IsUUID('4')
  interventionId!: string;

  @IsIn(['imagen', 'video', 'documento'])
  tipo!: 'imagen' | 'video' | 'documento';

  @IsString()
  @MaxLength(255)
  nombreArchivo!: string;

  @IsString()
  @Matches(
    /^evidencias\/[a-zA-Z0-9_-]+\/[0-9a-f-]+\/[0-9a-f-]+\.(?:jpg|png|webp|mp4|pdf)$/i,
  )
  objectKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descripcion?: string;

  @IsOptional()
  @IsUUID('4')
  actorId?: string;

  @IsOptional()
  @IsBoolean()
  actorIsAdmin?: boolean;
}

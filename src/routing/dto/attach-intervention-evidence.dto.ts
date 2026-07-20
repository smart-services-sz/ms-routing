import { IsIn, IsOptional, IsString, IsUUID, IsUrl, MaxLength } from 'class-validator';

export class AttachInterventionEvidenceDto {
  @IsUUID('4')
  interventionId!: string;

  @IsIn(['imagen', 'video', 'documento'])
  tipo!: 'imagen' | 'video' | 'documento';

  @IsString()
  @MaxLength(255)
  nombreArchivo!: string;

  @IsUrl()
  urlArchivo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descripcion?: string;
}

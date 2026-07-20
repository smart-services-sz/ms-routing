import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class RegisterInterventionDto {
  @IsUUID('4')
  routeId!: string;

  @IsUUID('4')
  stopId!: string;

  @IsIn(['resuelto', 'no_resuelto', 'requiere_nueva_visita', 'no_corresponde'])
  result!: 'resuelto' | 'no_resuelto' | 'requiere_nueva_visita' | 'no_corresponde';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observation?: string;

  @IsOptional()
  @IsString()
  performedBy?: string;
}

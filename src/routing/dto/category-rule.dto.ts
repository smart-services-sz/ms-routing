import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class CategoryRuleDto {
  @IsIn([
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
  ])
  categoria!: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  cupoDiario!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pesoPrioridad?: number;
}

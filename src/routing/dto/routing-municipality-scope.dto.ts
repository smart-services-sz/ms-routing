import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class RoutingMunicipalityScopeDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)
  municipalityId?: string;
}
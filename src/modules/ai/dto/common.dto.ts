import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../../common/validation/validators';
import { AuditEntryDto } from '../../knowledge/dto/knowledge-source.dto';

export class ChangeNoteDto {
  @ApiPropertyOptional({ maxLength: 1000, description: 'Why the change was made' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  changeNote?: string;
}

export class ConfigurationVersionDto {
  @ApiProperty() version: number;
  @ApiProperty({ type: 'object', additionalProperties: true }) snapshot: unknown;
  @ApiPropertyOptional({ type: String, nullable: true }) changeNote: string | null;
  @ApiProperty({ format: 'uuid' }) changedById: string;
  @ApiProperty() createdAt: Date;
}

export class ConfigurationHistoryDto {
  @ApiProperty({ type: ConfigurationVersionDto, isArray: true })
  versions: ConfigurationVersionDto[];
  @ApiProperty({ type: AuditEntryDto, isArray: true }) audit: AuditEntryDto[];
}

export class ProviderNoticeDto {
  @ApiProperty({ description: 'Whether a provider is registered for the configured models' })
  providerConfigured: boolean;
  @ApiProperty({ example: 'No AI provider is configured; no AI response will be generated.' })
  message: string;
}

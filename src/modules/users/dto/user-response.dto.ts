import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LocationResponseDto } from '../../../common/dto/location.dto';
import { PaginationMetaDto } from '../../../common/dto/pagination.dto';
import { FarmerCategory, FarmerType, Language, UserStatus } from '../../../generated/prisma/client';
import { ALL_PERMISSIONS, ALL_ROLE_CODES, type Permission, type RoleCode } from '../../roles/rbac.constants';

export class UserResponseDto {
  @ApiProperty({ format: 'uuid', example: '7d0c7a52-4f3e-4f11-9c55-2b8c1f0e6a41' })
  id: string;

  @ApiProperty({ example: 'Uwimana Jeanne' })
  fullName: string;

  @ApiProperty({ example: '+250788123456', description: 'E.164 format' })
  phoneNumber: string;

  @ApiPropertyOptional({ example: 'jeanne@example.rw', nullable: true, type: String })
  email: string | null;

  @ApiProperty({ enum: UserStatus, example: UserStatus.ACTIVE })
  status: UserStatus;

  @ApiPropertyOptional({ nullable: true, type: String, example: null })
  statusReason: string | null;

  @ApiPropertyOptional({ nullable: true, type: Date })
  statusChangedAt: Date | null;

  @ApiProperty({ enum: Language, example: Language.rw })
  preferredLanguage: Language;

  @ApiProperty({ enum: ALL_ROLE_CODES, isArray: true, example: ['SMARTPHONE_FARMER'] })
  roles: RoleCode[];

  @ApiPropertyOptional({
    nullable: true,
    type: Date,
    description: 'When the personal email was verified; null until the verification link is used',
  })
  emailVerifiedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, type: Date })
  lastLoginAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class FarmerProfileSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: FarmerType, example: FarmerType.SMARTPHONE })
  farmerType: FarmerType;

  @ApiProperty({ enum: FarmerCategory, example: FarmerCategory.SMALLHOLDER })
  farmerCategory: FarmerCategory;

  @ApiProperty()
  registeredAt: Date;
}

export class FacilitatorProfileSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Agronomist' })
  professionalTitle: string;

  @ApiProperty({ example: 'Rwanda Agriculture Board' })
  organization: string;

  @ApiPropertyOptional({ nullable: true, type: String, example: 'office@rab.gov.rw' })
  contactEmail: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, example: '+250788654321' })
  contactPhone: string | null;
}

export class UserDetailResponseDto extends UserResponseDto {
  @ApiPropertyOptional({ type: LocationResponseDto, nullable: true })
  location: LocationResponseDto | null;

  @ApiPropertyOptional({ type: FarmerProfileSummaryDto, nullable: true })
  farmerProfile: FarmerProfileSummaryDto | null;

  @ApiPropertyOptional({ type: FacilitatorProfileSummaryDto, nullable: true })
  facilitatorProfile: FacilitatorProfileSummaryDto | null;

  @ApiPropertyOptional({
    description: 'Only on create: true when the SMTP server accepted the verification email.',
  })
  emailSent?: boolean;
}

export class CurrentUserResponseDto extends UserDetailResponseDto {
  @ApiProperty({ enum: ALL_PERMISSIONS, isArray: true, example: [] })
  permissions: Permission[];
}

export class UserListResponseDto {
  @ApiProperty({ type: UserDetailResponseDto, isArray: true })
  data: UserDetailResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

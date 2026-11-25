import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationMetaDto, PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { Trim } from '../../../common/validation/validators';
import { AccountRequestStatus, ApprovalDecision } from '../../../generated/prisma/client';
import { FarmerRegistrationFieldsDto } from '../../farmers/dto/farmer.dto';
import { ALL_ROLE_CODES, RoleCode } from '../../roles/rbac.constants';
import { UserDetailResponseDto } from '../../users/dto/user-response.dto';

export class CreateAccountRequestDto extends FarmerRegistrationFieldsDto {
  @ApiPropertyOptional({
    example: 'Member of the Kinigi potato cooperative; registered during a field visit',
    maxLength: 1000,
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ApproveAccountRequestDto {
  @ApiPropertyOptional({ example: 'Identity confirmed by the sector agronomist', maxLength: 1000 })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class RejectAccountRequestDto {
  @ApiProperty({ example: 'Phone number could not be verified', minLength: 5, maxLength: 1000 })
  @Trim()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason: string;
}

export class ListAccountRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AccountRequestStatus, default: AccountRequestStatus.PENDING })
  @IsOptional()
  @IsEnum(AccountRequestStatus)
  status: AccountRequestStatus = AccountRequestStatus.PENDING;

  @ApiPropertyOptional({ enum: ALL_ROLE_CODES })
  @IsOptional()
  @IsIn(ALL_ROLE_CODES)
  requestedRole?: RoleCode;

  @ApiPropertyOptional({ description: 'Matches applicant name, phone number or email' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class UserReferenceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Niyonsaba Claudine' })
  fullName: string;
}

export class AccountDecisionDto {
  @ApiProperty({ enum: ApprovalDecision })
  decision: ApprovalDecision;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'Rejection reason or approval note' })
  reason: string | null;

  @ApiProperty()
  decidedAt: Date;

  @ApiProperty({ type: UserReferenceDto })
  decidedBy: UserReferenceDto;
}

export class AccountRequestResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ enum: AccountRequestStatus })
  status: AccountRequestStatus;

  @ApiProperty({ enum: ALL_ROLE_CODES })
  requestedRole: RoleCode;

  @ApiPropertyOptional({ nullable: true, type: String })
  notes: string | null;

  @ApiProperty({ type: UserDetailResponseDto })
  applicant: UserDetailResponseDto;

  @ApiPropertyOptional({
    type: UserReferenceDto,
    nullable: true,
    description: 'Facilitator or admin who submitted on the applicant\'s behalf; null for self-registration',
  })
  submittedBy: UserReferenceDto | null;

  @ApiPropertyOptional({ type: AccountDecisionDto, nullable: true })
  decision: AccountDecisionDto | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiPropertyOptional({
    description:
      'Only on approve/reject: whether the SMTP server accepted the verification (approve) or rejection email',
  })
  emailSent?: boolean;
}

export class AccountRequestListResponseDto {
  @ApiProperty({ type: AccountRequestResponseDto, isArray: true })
  data: AccountRequestResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}

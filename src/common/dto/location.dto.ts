import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  registerDecorator,
  type ValidationArguments,
} from 'class-validator';
import { Province } from '../../generated/prisma/client';
import { DISTRICTS_BY_PROVINCE, findDistrict } from '../rwanda/administrative-divisions';
import { Trim } from '../validation/validators';

function IsDistrictOfProvince(): PropertyDecorator {
  return (target, propertyName) =>
    registerDecorator({
      name: 'isDistrictOfProvince',
      target: target.constructor,
      propertyName: propertyName as string,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const province = (args.object as { province?: Province }).province;
          if (typeof value !== 'string' || !province || !DISTRICTS_BY_PROVINCE[province]) {
            return true; // reported by the province/string validators
          }
          return findDistrict(province, value) !== undefined;
        },
        defaultMessage(args: ValidationArguments) {
          const province = (args.object as { province?: Province }).province as Province;
          return `district must be one of the districts of ${province}: ${DISTRICTS_BY_PROVINCE[province].join(', ')}`;
        },
      },
    });
}

/**
 * Sector is declared by each subclass: class-validator merges inherited
 * metadata, so a parent @IsOptional() would make a redeclared field optional.
 */
abstract class BaseLocationDto {
  @ApiProperty({ enum: Province, example: Province.NORTHERN })
  @IsEnum(Province)
  province: Province;

  @ApiProperty({ example: 'Musanze', description: 'Must belong to the selected province' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @IsDistrictOfProvince()
  district: string;

  abstract sector?: string;

  @ApiPropertyOptional({ example: 'Ruhengeri' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  cell?: string;

  @ApiPropertyOptional({ example: 'Kigombe' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  village?: string;
}

export class LocationDto extends BaseLocationDto {
  @ApiPropertyOptional({ example: 'Muhoza' })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(80)
  sector?: string;
}

/** Farmers must at least provide their sector. */
export class FarmerLocationDto extends BaseLocationDto {
  @ApiProperty({ example: 'Muhoza' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  sector: string;
}

/** Province and district, with an optional sector. No cell or village. */
export class TargetingLocationDto {
  @ApiProperty({ enum: Province, example: Province.NORTHERN })
  @IsEnum(Province)
  province: Province;

  @ApiProperty({ example: 'Musanze', description: 'Must belong to the selected province' })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @IsDistrictOfProvince()
  district: string;

  @ApiPropertyOptional({ example: 'Muhoza', description: 'Omit to cover the whole district' })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  sector?: string;
}

export class LocationResponseDto {
  @ApiProperty({ enum: Province, example: Province.NORTHERN })
  province: Province;

  @ApiProperty({ example: 'Musanze' })
  district: string;

  @ApiPropertyOptional({ example: 'Muhoza', nullable: true })
  sector: string | null;

  @ApiPropertyOptional({ example: 'Ruhengeri', nullable: true })
  cell: string | null;

  @ApiPropertyOptional({ example: 'Kigombe', nullable: true })
  village: string | null;
}

/** Canonical spelling for persisted districts (e.g. "musanze" -> "Musanze"). */
export function normalizeLocation<T extends { province: Province; district: string }>(location: T): T {
  return { ...location, district: findDistrict(location.province, location.district) ?? location.district };
}

import { TargetAudience, type Prisma, type Province } from '../../generated/prisma/client';
import { RoleCode } from '../roles/rbac.constants';

export interface AreaMatch {
  cropId: string;
  province: Province;
  district: string;
  /** Null on a targeting group means the whole district. */
  sector: string | null;
}

function sameText(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

/**
 * A facilitator group may receive a targeted course when its crop and location
 * fall inside a targeting group. Farmer-type audience is applied when a farmer
 * opens the catalogue, not when the group is assigned.
 */
export function groupMatchesTargeting(group: AreaMatch, target: AreaMatch): boolean {
  if (group.cropId !== target.cropId) return false;
  if (group.province !== target.province) return false;
  if (!sameText(group.district, target.district)) return false;
  if (target.sector && !sameText(group.sector ?? '', target.sector)) return false;
  return true;
}

/** Prisma filter equivalent of groupMatchesTargeting, for course listings. */
export function targetingMatchWhere(group: AreaMatch): Prisma.AdminTargetingGroupWhereInput {
  return {
    cropId: group.cropId,
    province: group.province,
    district: { equals: group.district, mode: 'insensitive' },
    OR: [{ sector: null }, { sector: { equals: group.sector ?? '', mode: 'insensitive' } }],
  };
}

/** Audiences a farmer may see. Someone who is both types only sees courses for everyone. */
export function audiencesForRoles(roles: readonly string[]): TargetAudience[] | null {
  const smartphone = roles.includes(RoleCode.SmartphoneFarmer);
  const basic = roles.includes(RoleCode.BasicPhoneFarmer);
  if (!smartphone && !basic) return null;
  if (smartphone && basic) return [TargetAudience.ALL_FARMERS];
  return smartphone
    ? [TargetAudience.ALL_FARMERS, TargetAudience.SMARTPHONE_FARMERS]
    : [TargetAudience.ALL_FARMERS, TargetAudience.BASIC_PHONE_FARMERS];
}

export function audienceAllows(audience: TargetAudience, roles: readonly string[]): boolean {
  return audiencesForRoles(roles)?.includes(audience) ?? false;
}

export interface FarmerArea {
  province: Province;
  district: string;
  sector: string | null;
  /** Crops of the active facilitator groups this farmer belongs to. */
  cropIds: string[];
}

/** A targeted publication matches the farmer's own location and one of their group crops. */
export function farmerMatchesTarget(farmer: FarmerArea, target: AreaMatch): boolean {
  if (!farmer.cropIds.includes(target.cropId)) return false;
  return groupMatchesTargeting(
    { cropId: target.cropId, province: farmer.province, district: farmer.district, sector: farmer.sector },
    target,
  );
}

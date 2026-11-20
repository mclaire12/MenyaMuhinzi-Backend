import { Province, TargetAudience } from '../../generated/prisma/client';
import { RoleCode } from '../roles/rbac.constants';
import { audienceAllows, farmerMatchesTarget, groupMatchesTargeting, type AreaMatch } from './publication-eligibility';

const group: AreaMatch = {
  cropId: 'tomato',
  province: Province.NORTHERN,
  district: 'Musanze',
  sector: 'Kinigi',
};

describe('groupMatchesTargeting', () => {
  it('matches a district-wide target with the same crop', () => {
    const target: AreaMatch = { ...group, sector: null };
    expect(groupMatchesTargeting(group, target)).toBe(true);
  });

  it('matches a sector target only for that sector, ignoring case', () => {
    expect(groupMatchesTargeting(group, { ...group, sector: 'kinigi' })).toBe(true);
    expect(groupMatchesTargeting(group, { ...group, sector: 'Muhoza' })).toBe(false);
  });

  it('rejects a different crop, district or province', () => {
    expect(groupMatchesTargeting(group, { ...group, cropId: 'cabbage', sector: null })).toBe(false);
    expect(groupMatchesTargeting(group, { ...group, district: 'Gicumbi', sector: null })).toBe(false);
    expect(groupMatchesTargeting(group, { ...group, province: Province.SOUTHERN, sector: null })).toBe(false);
  });
});

describe('farmer audience', () => {
  it('keeps smartphone and basic-phone courses apart', () => {
    expect(audienceAllows(TargetAudience.ALL_FARMERS, [RoleCode.SmartphoneFarmer])).toBe(true);
    expect(audienceAllows(TargetAudience.SMARTPHONE_FARMERS, [RoleCode.SmartphoneFarmer])).toBe(true);
    expect(audienceAllows(TargetAudience.BASIC_PHONE_FARMERS, [RoleCode.SmartphoneFarmer])).toBe(false);
    expect(audienceAllows(TargetAudience.SMARTPHONE_FARMERS, [RoleCode.BasicPhoneFarmer])).toBe(false);
    expect(audienceAllows(TargetAudience.BASIC_PHONE_FARMERS, [RoleCode.BasicPhoneFarmer])).toBe(true);
  });

  it('matches a targeted course only for the farmer location and a group crop', () => {
    const farmer = { province: Province.NORTHERN, district: 'Musanze', sector: 'Kinigi', cropIds: ['tomato'] };
    expect(farmerMatchesTarget(farmer, { ...group, sector: null })).toBe(true);
    expect(farmerMatchesTarget(farmer, { ...group, cropId: 'cabbage', sector: null })).toBe(false);
    expect(farmerMatchesTarget({ ...farmer, district: 'Gicumbi' }, { ...group, sector: null })).toBe(false);
  });
});

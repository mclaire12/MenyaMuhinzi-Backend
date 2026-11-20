import { Province } from '../../generated/prisma/client';
import { DISTRICTS_BY_PROVINCE, findDistrict } from './administrative-divisions';

describe('Rwanda administrative divisions', () => {
  it('lists the 30 districts across the 5 provinces', () => {
    expect(Object.keys(DISTRICTS_BY_PROVINCE).sort()).toEqual(Object.values(Province).sort());
    const districts = Object.values(DISTRICTS_BY_PROVINCE).flat();
    expect(districts).toHaveLength(30);
    expect(new Set(districts).size).toBe(30);
  });

  it('matches districts case-insensitively and returns the canonical spelling', () => {
    expect(findDistrict(Province.NORTHERN, 'musanze')).toBe('Musanze');
    expect(findDistrict(Province.KIGALI_CITY, ' GASABO ')).toBe('Gasabo');
  });

  it('rejects districts from another province', () => {
    expect(findDistrict(Province.SOUTHERN, 'Musanze')).toBeUndefined();
  });
});

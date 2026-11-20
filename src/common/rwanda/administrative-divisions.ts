import { Province } from '../../generated/prisma/client';

/** The 30 districts of Rwanda grouped by province. */
export const DISTRICTS_BY_PROVINCE: Record<Province, readonly string[]> = {
  KIGALI_CITY: ['Gasabo', 'Kicukiro', 'Nyarugenge'],
  NORTHERN: ['Burera', 'Gakenke', 'Gicumbi', 'Musanze', 'Rulindo'],
  SOUTHERN: [
    'Gisagara',
    'Huye',
    'Kamonyi',
    'Muhanga',
    'Nyamagabe',
    'Nyanza',
    'Nyaruguru',
    'Ruhango',
  ],
  EASTERN: ['Bugesera', 'Gatsibo', 'Kayonza', 'Kirehe', 'Ngoma', 'Nyagatare', 'Rwamagana'],
  WESTERN: ['Karongi', 'Ngororero', 'Nyabihu', 'Nyamasheke', 'Rubavu', 'Rusizi', 'Rutsiro'],
};

/** Returns the canonical district spelling, or undefined if it is not in the province. */
export function findDistrict(province: Province, district: string): string | undefined {
  const wanted = district.trim().toLowerCase();
  return DISTRICTS_BY_PROVINCE[province]?.find((name) => name.toLowerCase() === wanted);
}

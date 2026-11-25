/**
 * Professional titles a facilitator / agronomist can choose when self-registering.
 *
 * No approved list existed in the project, so this is a deliberately small, configurable
 * set. The value is stored as-is in `facilitator_profiles.professionalTitle`, so it also
 * serves as the display label. To add a title, append it here and to
 * `FACILITATOR_TITLE_OPTIONS` in the frontend (src/components/auth/facilitator-titles.ts).
 * Existing profiles with other titles are unaffected; only new registrations are validated.
 */
export const FACILITATOR_TITLES = [
  'Agronomist',
  'Agricultural Extension Officer',
  'Crop Production Officer',
  'Farmer Promoter',
] as const;

export type FacilitatorTitle = (typeof FACILITATOR_TITLES)[number];

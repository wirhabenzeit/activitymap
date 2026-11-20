/**
 * Public legal and support pages (issue #585). The App Store Connect listing,
 * the iOS About screen and the web About tab all point at these paths, so the
 * paths, the operator and the contact address live in exactly one place.
 *
 * The policy text in `src/app/(legal)/` describes behaviour that is enforced
 * elsewhere (`docs/strava-data-policy.md`); change the two together.
 */
export const LEGAL_PATHS = {
  privacy: '/privacy',
  terms: '/terms',
  support: '/support',
} as const;

export type LegalPage = keyof typeof LEGAL_PATHS;

/** The person who operates ActivityMap and is responsible for its data. */
export const LEGAL_OPERATOR = 'Dominik Schröder';

/**
 * Where privacy requests and support questions go. The address must be able
 * to receive mail before the pages ship: App Review and Strava both check it.
 */
export const LEGAL_CONTACT_EMAIL = 'support@activitymap.cc';

/** Source repository, for bug reports that do not involve personal data. */
export const LEGAL_ISSUES_URL =
  'https://github.com/wirhabenzeit/activitymap/issues';

/** Bump when the text of the privacy policy or the terms changes. */
export const LEGAL_LAST_UPDATED = '2026-11-20';

export function legalMailto(subject?: string): string {
  const query = subject ? `?subject=${encodeURIComponent(subject)}` : '';
  return `mailto:${LEGAL_CONTACT_EMAIL}${query}`;
}

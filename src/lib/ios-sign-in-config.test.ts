import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * The https sign-in callback only works when four files agree (issue #482):
 * the server's apple-app-site-association file, the app's entitlements, the
 * redirect URI in the xcconfig, and the app's bundle identifier and team.
 * Nothing at build time notices a mismatch; sign-in just silently never
 * returns. This reads them side by side.
 */
const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const xcconfig = read('ios/ActivityMap/Config/Base.xcconfig');
const project = read('ios/ActivityMap/ActivityMap.xcodeproj/project.pbxproj');
const entitlements = read(
  'ios/ActivityMap/ActivityMap/ActivityMap.entitlements',
);
const aasa = JSON.parse(
  read('public/.well-known/apple-app-site-association'),
) as {
  webcredentials: { apps: string[] };
  applinks: {
    details: Array<{ appIDs: string[]; components: Array<{ '/': string }> }>;
  };
};

const setting = (name: string) =>
  new RegExp(`^${name.replace(/[[\]*]/g, '\\$&')}\\s*=\\s*(.+)$`, 'm').exec(
    xcconfig,
  )?.[1];

void test('the app is associated with the domain that serves its callback', () => {
  const domain = setting('ACTIVITYMAP_ASSOCIATED_DOMAIN');
  assert.ok(domain, 'Base.xcconfig names the associated domain');
  assert.match(
    entitlements,
    /webcredentials:\$\(ACTIVITYMAP_ASSOCIATED_DOMAIN\)/,
    'the entitlement uses the xcconfig domain',
  );
  assert.match(
    entitlements,
    /applinks:\$\(ACTIVITYMAP_ASSOCIATED_DOMAIN\)/,
    'the Strava app return is an applink on the same domain',
  );
  assert.equal(
    setting('ACTIVITYMAP_AUTH_REDIRECT_URI[sdk=iphoneos*]'),
    `https:$(SLASH)$(SLASH)$(ACTIVITYMAP_ASSOCIATED_DOMAIN)/auth/callback`,
    'devices return through https on that domain',
  );
  assert.equal(
    setting('ACTIVITYMAP_API_BASE_URL[sdk=iphoneos*]'),
    `https:$(SLASH)$(SLASH)${domain}`,
    'the API and the callback share one host',
  );
});

void test('the AASA file names this app: team ID plus bundle identifier', () => {
  const team = /DEVELOPMENT_TEAM = (\w+);/.exec(project)?.[1];
  const bundle =
    /PRODUCT_BUNDLE_IDENTIFIER = "(page\.dominik\.activitymap)\$\(ACTIVITYMAP_BUNDLE_ID_SUFFIX\)";/.exec(
      project,
    )?.[1];
  assert.ok(team && bundle);
  assert.deepEqual(aasa.webcredentials.apps, [`${team}.${bundle}`]);
  assert.deepEqual(
    aasa.applinks.details.map((detail) => detail.appIDs),
    [[`${team}.${bundle}`]],
  );
});

void test('the Strava app return is the one path the AASA file sends to the app', () => {
  // The device redirect Strava is given (issue #305) must be an applink of
  // this app, and the landing page must exist for the not-installed case.
  const redirect = setting(
    'ACTIVITYMAP_STRAVA_APP_REDIRECT_URI[sdk=iphoneos*]',
  );
  assert.equal(
    redirect,
    `https:$(SLASH)$(SLASH)$(ACTIVITYMAP_ASSOCIATED_DOMAIN)/auth/strava`,
  );
  const [detail] = aasa.applinks.details;
  assert.deepEqual(
    detail?.components.map((component) => component['/']),
    ['/auth/strava'],
  );
  assert.ok(
    read('src/app/auth/strava/page.tsx').includes('Return to ActivityMap'),
  );
});

void test('the app target carries the entitlements file in every configuration', () => {
  assert.equal(
    project.match(
      /CODE_SIGN_ENTITLEMENTS = ActivityMap\/ActivityMap\.entitlements;/g,
    )?.length,
    2,
  );
  // Synchronized groups bundle every file as a resource unless excepted.
  assert.match(
    project,
    /membershipExceptions = \([^)]*ActivityMap\.entitlements,/,
  );
});

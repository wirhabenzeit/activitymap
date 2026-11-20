import type { Metadata } from 'next';

import { LegalPage } from '~/components/legal/legal-page';
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_OPERATOR,
  LEGAL_PATHS,
  legalMailto,
} from '~/lib/legal';

export const metadata: Metadata = {
  title: 'Terms of use · ActivityMap',
  description: 'The rules for using ActivityMap.',
};

/** Short terms of use for the public release (issue #585). */
export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <p>
        These terms apply when you use ActivityMap, the website at
        activitymap.cc and the iPhone and iPad app, operated by {LEGAL_OPERATOR}
        . By connecting your Strava account you agree to them. How we handle
        your data is explained in the{' '}
        <a href={LEGAL_PATHS.privacy}>privacy policy</a>.
      </p>

      <h2>The service</h2>
      <p>
        ActivityMap is a free tool to view your own Strava activities on a map,
        in a list and in statistics, and to share chosen tracks by private link.
        It is not made or endorsed by Strava. &ldquo;Strava&rdquo; and its logos
        belong to Strava, Inc.
      </p>

      <h2>Your account and Strava</h2>
      <ul>
        <li>
          You sign in with Strava, and you must follow Strava&rsquo;s own terms
          and API Agreement. If Strava ends your access, ActivityMap stops
          working for you.
        </li>
        <li>
          You may use ActivityMap only with your own account and data, and you
          must not try to access anyone else&rsquo;s.
        </li>
        <li>
          You are responsible for what you share. A share link is visible to
          anyone who has it until it expires or you revoke it.
        </li>
        <li>
          You can delete your ActivityMap account and data at any time from
          Settings, in the Account section.
        </li>
      </ul>

      <h2>Acceptable use</h2>
      <p>
        Do not interfere with the service, attempt to bypass its limits or
        security, scrape it, or use it in a way that breaks the law or
        Strava&rsquo;s rules. We may suspend access that does.
      </p>

      <h2>Accuracy, safety and availability</h2>
      <p>
        Maps, elevation, place names and statistics come from your recorded data
        and third-party sources, and may be wrong or out of date. Do not rely on
        ActivityMap for navigation or safety decisions in the outdoors. The
        service is provided &ldquo;as is&rdquo;, without a promise that it will
        always be available or error free, and it may change or be discontinued.
      </p>

      <h2>Liability</h2>
      <p>
        To the extent the law allows, we are not liable for indirect or
        consequential loss, or for loss of data, arising from your use of
        ActivityMap. Nothing here limits liability that cannot be limited by
        law, including for intent, gross negligence or injury to life, body or
        health.
      </p>

      <h2>Changes and contact</h2>
      <p>
        We may update these terms; the date above shows the latest version, and
        continued use means you accept it. Questions:{' '}
        <a href={legalMailto('Terms question')}>{LEGAL_CONTACT_EMAIL}</a>.
      </p>
    </LegalPage>
  );
}

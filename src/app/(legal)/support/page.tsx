import type { Metadata } from 'next';

import { LegalPage } from '~/components/legal/legal-page';
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_ISSUES_URL,
  LEGAL_PATHS,
  legalMailto,
} from '~/lib/legal';

export const metadata: Metadata = {
  title: 'Support · ActivityMap',
  description: 'Get help with ActivityMap.',
};

/** The support URL for the App Store listing (issue #585). */
export default function SupportPage() {
  return (
    <LegalPage title="Support" updated={false}>
      <p>
        Need help with ActivityMap, found a bug, or want your data removed?
        Email{' '}
        <a href={legalMailto('ActivityMap support')}>{LEGAL_CONTACT_EMAIL}</a>.
        Please say whether you use the iPhone app or the website and, for the
        app, the version shown under Settings &rsaquo; About ActivityMap. Never
        send your Strava password.
      </p>

      <h2>Common questions</h2>
      <h3>My activities are missing or out of date</h3>
      <p>
        New activities normally arrive from Strava within minutes; a first
        import of a large history can take a while because Strava limits how
        fast we may request data. If an activity is still missing, open Settings
        and choose <strong>Check Strava for missing activities</strong>; to
        update a single activity, refresh it from its detail view. If sync says
        Strava is disconnected, sign out and connect again from the Account
        section of Settings.
      </p>
      <h3>I cannot sign in</h3>
      <p>
        Sign in uses Strava&rsquo;s own page. Make sure you approve all
        requested permissions, and that ActivityMap was not removed under
        &ldquo;My Apps&rdquo; in your Strava settings. If it still fails, email
        us with the time of the attempt.
      </p>
      <h3>How do I delete my data?</h3>
      <p>
        In the app, tap your profile picture at the top right and choose{' '}
        <strong>Delete account and data</strong> in the Account section; on the
        website open Settings, then Account. This is permanent and immediate,
        and does not touch your activities on Strava. The{' '}
        <a href={LEGAL_PATHS.privacy}>privacy policy</a> explains what is
        removed.
      </p>
      <h3>Where is my shared link?</h3>
      <p>
        Share links you created are listed under Share in the website, where you
        can revoke them. Links expire after at most 30 days.
      </p>

      <h2>Bug reports</h2>
      <p>
        Reports that contain no personal data can also be filed on{' '}
        <a href={LEGAL_ISSUES_URL}>GitHub</a>.
      </p>
    </LegalPage>
  );
}

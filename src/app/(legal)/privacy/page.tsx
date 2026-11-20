import type { Metadata } from 'next';

import { LegalPage } from '~/components/legal/legal-page';
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_OPERATOR,
  LEGAL_PATHS,
  legalMailto,
} from '~/lib/legal';

export const metadata: Metadata = {
  title: 'Privacy policy · ActivityMap',
  description:
    'What ActivityMap stores about you, why, who else sees it, and how to delete it.',
};

/**
 * The privacy policy named in the App Store listing and linked from both
 * clients (issue #585). It restates `docs/strava-data-policy.md`; keep the
 * two consistent, and keep the iOS privacy manifest and App Privacy answers
 * (issue #586) in step with it.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        ActivityMap shows your Strava activities on a map, in a list and in
        statistics. It is operated by {LEGAL_OPERATOR} (&ldquo;we&rdquo;), who
        is responsible for the personal data described here. It applies to the
        website at activitymap.cc and to the ActivityMap iPhone and iPad app.
      </p>
      <p>
        In short: we use your Strava data only to show it back to you. We do not
        sell it, show advertising, track you across other apps or websites, or
        use it to train AI models.
      </p>

      <h2>What we collect</h2>
      <p>
        Everything below comes from Strava after you choose{' '}
        <strong>Connect with Strava</strong> and approve access. We never see
        your Strava password.
      </p>
      <ul>
        <li>
          <strong>Profile:</strong> your name, profile picture and Strava
          athlete ID. Strava does not normally share an email address; if one is
          provided we keep it for your account.
        </li>
        <li>
          <strong>Activities:</strong> names, sport types, dates, distance,
          moving and elapsed time, elevation, the recorded route, and the
          detailed time series Strava provides for an activity (position,
          altitude, speed, heart rate and power, where recorded). This includes
          activities you marked private in Strava, because ActivityMap asks for
          that permission.
        </li>
        <li>
          <strong>Photos:</strong> the photos attached to your Strava
          activities, which are shown from Strava&rsquo;s own image servers and
          cached on your device.
        </li>
        <li>
          <strong>Places:</strong> which named places (summits, passes, huts)
          your routes passed, calculated by us from your routes and public map
          data.
        </li>
        <li>
          <strong>Sharing:</strong> the private share links you create, stored
          only as a one-way hash, with their expiry.
        </li>
        <li>
          <strong>Account and security data:</strong> sign-in sessions, the
          access tokens Strava issues to us, your display preferences, and
          technical logs (request times and error codes) with credentials and
          share tokens removed.
        </li>
      </ul>
      <p>
        We ask Strava for these permissions: read your profile, read your
        activities including private ones, and write activities. We write to
        Strava only when you edit an activity in ActivityMap and save the
        change.
      </p>

      <h2>What we do not collect</h2>
      <ul>
        <li>
          Your device location is never sent to us. When you tap{' '}
          <strong>Locate me</strong> on the map, the app asks iOS for one
          position and uses it on your device to centre the map. If you decline,
          everything else keeps working.
        </li>
        <li>
          No advertising identifier, no contacts, no analytics or
          crash-reporting SDK in the app.
        </li>
      </ul>

      <h2>Why we use it</h2>
      <p>
        We use your data to import your activities, keep them up to date, draw
        your maps and statistics, create share links when you ask, and keep your
        account secure. We do not use it for anything else, and we do not make
        decisions about you with it.
      </p>

      <h2>Who else processes it</h2>
      <ul>
        <li>
          <strong>Strava</strong> is the source of your data. Their privacy
          policy applies to what they hold.
        </li>
        <li>
          <strong>Vercel</strong> hosts the website and API. The website also
          uses Vercel Web Analytics and Speed Insights, which count page views
          and measure page speed without cookies. Pages with private share links
          are excluded. The iPhone app has no analytics.
        </li>
        <li>
          <strong>Convex</strong> stores the database that holds the data above.
        </li>
        <li>
          <strong>Cloudflare</strong> runs the scheduled job that triggers
          background updates. It does not receive your activity data.
        </li>
        <li>
          <strong>Map providers</strong> (MapTiler, OpenFreeMap, Mapterhorn, and
          the public map and overlay services listed in the map&rsquo;s credits,
          depending on the map and overlays you choose) receive ordinary tile
          requests, so they see your IP address and the area you are viewing.
          They do not receive your account, your activities or your routes.
        </li>
      </ul>
      <p>
        These providers act on our behalf and may process data outside your
        country, including in the United States and the European Union. Their
        own policies apply to the data they receive.
      </p>

      <h2>Sharing with others</h2>
      <p>
        Nobody else can see your data unless you create a share link. A link
        shows only the activities you picked, as a map with route, elevation,
        name, sport, date, distance, time and climb. It never shows heart rate,
        power, photos, descriptions, other athletes, or the exact start and end
        of a route (the first and last 200 m are hidden unless you turn that
        off). Links expire after at most 30 days and you can revoke them at any
        time. Anyone who has the link can open it, so send it only to people you
        trust.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>
          Strava data is re-checked against Strava at least every seven days.
          Anything you delete in Strava, or that Strava makes unavailable, is
          removed from ActivityMap within 48 hours.
        </li>
        <li>
          If you revoke ActivityMap&rsquo;s access in Strava, we stop using your
          credentials at once, disable your share links, and permanently delete
          your Strava-derived data within 30 days.
        </li>
        <li>
          Sign-in sessions last 30 days, renew while you use ActivityMap, and
          end when you sign out.
        </li>
      </ul>

      <h2>Your choices and rights</h2>
      <ul>
        <li>
          <strong>Delete everything now:</strong> in the app open Account and
          choose <strong>Delete account and data</strong> (on the website:
          Settings, Account). This immediately removes your account, sessions,
          imported activities, photos, streams, share links and sync state. It
          does not delete your activities on Strava, and signing in again
          creates a new, empty account.
        </li>
        <li>
          <strong>Sign out</strong> removes the locally cached activities from
          that device.
        </li>
        <li>
          <strong>Disconnect</strong> ActivityMap in your Strava settings under
          &ldquo;My Apps&rdquo; at any time.
        </li>
        <li>
          You can ask us for a copy of your data, a correction, or deletion by
          emailing{' '}
          <a href={legalMailto('Privacy request')}>{LEGAL_CONTACT_EMAIL}</a>. If
          you live in the EU or UK you also have the right to object to our
          processing and to complain to your data protection authority. We
          process your data to provide the service you asked for.
        </li>
      </ul>

      <h2>Children</h2>
      <p>
        ActivityMap is not directed at children. You must meet Strava&rsquo;s
        minimum age to connect an account.
      </p>

      <h2>Changes</h2>
      <p>
        If we change what we collect or how we use it, we will update this page
        and its date, and ask for your permission again where the law requires.
      </p>

      <h2>Contact</h2>
      <p>
        {LEGAL_OPERATOR},{' '}
        <a href={legalMailto('Privacy question')}>{LEGAL_CONTACT_EMAIL}</a>. See
        also the <a href={LEGAL_PATHS.terms}>terms of use</a> and{' '}
        <a href={LEGAL_PATHS.support}>support</a> page.
      </p>
    </LegalPage>
  );
}

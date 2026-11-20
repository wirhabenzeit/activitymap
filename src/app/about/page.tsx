import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import { PoweredByStrava } from '~/components/powered-by-strava';
import {
  APP_STORE_URL,
  LEGAL_OPERATOR,
  LEGAL_PATHS,
  MARKETING_PATH,
} from '~/lib/legal';

const TITLE = 'ActivityMap: every activity on one map';
const DESCRIPTION =
  'See your Strava runs, rides, hikes and ski tours on one map, in a list and in stats. Free, private and offline-ready, for the web, iPhone and iPad.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: MARKETING_PATH },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: MARKETING_PATH,
    siteName: 'ActivityMap',
    type: 'website',
    images: [{ url: '/about/og.jpg', width: 1200, height: 630 }],
  },
};

/**
 * The public marketing page and the App Store "Marketing URL" (issue #589).
 * It sits outside the authenticated `(app)` shell so anyone, signed in or
 * not, can see what ActivityMap looks like before connecting Strava. The
 * screenshots are generated from the synthetic gallery library
 * (`scripts/ios-gallery.sh`), never from a personal account.
 *
 * Strava's brand rules apply here too: the name "Strava" appears only in
 * plain factual text and the official "Powered by Strava" logo, which stays
 * small and apart from the app name, and the page says ActivityMap is
 * independent of Strava.
 */

/**
 * `dark` marks screenshots that also exist in a dark appearance. The gallery's
 * map styles stay light in dark mode, so map shots have no dark version and are
 * shown unchanged.
 */
type Shot = { name: string; alt: string; dark: boolean };

const SHOTS = {
  overview: {
    name: 'map',
    dark: false,
    alt: 'The ActivityMap map showing routes around Zurich on a street map',
  },
  results: {
    name: 'map-results',
    dark: false,
    alt: 'Four selected routes on the map with a panel listing each activity',
  },
  list: {
    name: 'list',
    dark: true,
    alt: 'The activity list with distance, time and climb for each activity',
  },
  stats: {
    name: 'stats',
    dark: true,
    alt: 'The Records tile ranking your longest distances, longest moving times and biggest climbs',
  },
} satisfies Record<string, Shot>;

const SECTIONS = [
  {
    id: 'map',
    title: 'See where you have really been',
    body: 'Every run, ride, hike and ski tour drawn together on one map and colored by sport. Tap routes to select them, fit them on screen and open their details.',
    points: [
      'Street, outdoor, satellite and dark maps, plus swisstopo and Norwegian topographic maps',
      'Ski, hiking and cycling route overlays',
      'A 3D view, and Locate me to center the map where you are',
      'Photos from your activities on the map, with a swipeable gallery',
    ],
    shot: SHOTS.overview,
  },
  {
    id: 'list',
    title: 'Your whole history at a glance',
    body: 'Scan and sort every activity with distance, time and climb side by side, then step through them with Previous and Next. On iPad the list sits beside the detail.',
    points: [
      'Filter by sport, date, distance, duration and elevation',
      'Search by activity name, or by the summit, pass or hut you passed',
      'Route, elevation profile and a scrubber that follows your position',
    ],
    shot: SHOTS.list,
  },
  {
    id: 'stats',
    title: 'Numbers that mean something',
    body: 'A dashboard of tiles and charts built from your own data: totals, weekly volume, year to date, records, an activity calendar, sport mix and speed trend. Open any tile to dig in.',
    points: [
      'The same filters as the map and list',
      'Compare this week and month with your own typical ones',
    ],
    shot: SHOTS.stats,
  },
] as const;

const EXTRAS = [
  {
    title: 'Export and share',
    body: 'Export any route as GPX, or send a private, expiring link to a map of the tracks you pick. The start and end of each route are hidden by default.',
  },
  {
    title: 'Edit and sync',
    body: 'New activities arrive automatically. Change an activity’s name, sport or description and ActivityMap sends it back to Strava.',
  },
  {
    title: 'Works offline',
    body: 'Your library is cached on your device, so you can browse your history without a connection.',
  },
] as const;

const PRIVACY = [
  'Your data is used only to show it back to you',
  'No ads, no tracking, no analytics in the iPhone app',
  'Delete your account and data any time; your activities on Strava are never touched',
] as const;

function Phone({ shot, priority = false }: { shot: Shot; priority?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-[17rem]">
      <picture>
        {shot.dark && (
          <source
            media="(prefers-color-scheme: dark)"
            srcSet={`/about/${shot.name}-dark.webp`}
          />
        )}
        <Image
          src={`/about/${shot.name}-light.webp`}
          alt={shot.alt}
          width={804}
          height={1748}
          priority={priority}
          sizes="(min-width: 768px) 17rem, 70vw"
          className="h-auto w-full rounded-[2.25rem] border border-border shadow-xl"
        />
      </picture>
    </div>
  );
}

export default function AboutPage() {
  return (
    <div className="fixed inset-0 overflow-y-auto bg-background text-foreground">
      <header className="bg-[#1976d2] text-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <span className="text-lg font-semibold">ActivityMap</span>
          <nav aria-label="Site" className="flex items-center gap-4 text-sm">
            <Link
              href={LEGAL_PATHS.privacy}
              className="underline-offset-4 hover:underline"
            >
              Privacy
            </Link>
            <Link
              href={LEGAL_PATHS.support}
              className="underline-offset-4 hover:underline"
            >
              Support
            </Link>
            <Link
              href="/map"
              className="rounded-md border border-white/70 px-3 py-1.5 font-medium hover:bg-white/10"
            >
              Open the web app
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-5xl items-center gap-10 px-4 py-12 md:grid-cols-2 md:py-20">
          <div className="space-y-6">
            <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
              Every activity, on one map.
            </h1>
            <p className="text-lg text-muted-foreground">
              ActivityMap shows your Strava runs, rides, hikes and ski tours on
              a map, in a list and in stats. Free, private and offline-ready.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/map"
                className="rounded-md bg-[#1976d2] px-5 py-2.5 font-medium text-white hover:bg-[#1565c0]"
              >
                Open the web app
              </Link>
              {APP_STORE_URL ? (
                <a
                  href={APP_STORE_URL}
                  className="rounded-md border border-border px-5 py-2.5 font-medium hover:bg-muted"
                >
                  Download on the App Store
                </a>
              ) : (
                <span className="text-sm text-muted-foreground">
                  iPhone and iPad app coming soon
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Sign in with your Strava account. ActivityMap reads your
              activities and never sees your Strava password.
            </p>
          </div>
          <Phone shot={SHOTS.results} priority />
        </section>

        {SECTIONS.map((section, index) => (
          <section
            key={section.id}
            id={section.id}
            className={index % 2 === 0 ? 'bg-muted/40' : undefined}
          >
            <div
              className={`mx-auto grid max-w-5xl items-center gap-10 px-4 py-14 md:grid-cols-2 ${
                index % 2 === 1 ? 'md:[&>:first-child]:order-2' : ''
              }`}
            >
              <div className="space-y-4">
                <h2 className="text-3xl font-semibold tracking-tight text-balance">
                  {section.title}
                </h2>
                <p className="text-muted-foreground">{section.body}</p>
                <ul className="space-y-2">
                  {section.points.map((point) => (
                    <li key={point} className="ml-5 list-disc pl-1">
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
              <Phone shot={section.shot} />
            </div>
          </section>
        ))}

        <section className="mx-auto max-w-5xl px-4 py-14">
          <div className="grid gap-8 md:grid-cols-3">
            {EXTRAS.map((extra) => (
              <div key={extra.title} className="space-y-2">
                <h2 className="text-xl font-semibold">{extra.title}</h2>
                <p className="text-muted-foreground">{extra.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-muted/40">
          <div className="mx-auto max-w-5xl space-y-4 px-4 py-14">
            <h2 className="text-3xl font-semibold tracking-tight">
              Private by design
            </h2>
            <ul className="space-y-2">
              {PRIVACY.map((line) => (
                <li key={line} className="ml-5 list-disc pl-1">
                  {line}
                </li>
              ))}
            </ul>
            <p>
              <Link
                href={LEGAL_PATHS.privacy}
                className="underline underline-offset-2"
              >
                Read the privacy policy
              </Link>
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] text-sm text-muted-foreground">
          <PoweredByStrava />
          <p>
            ActivityMap is an independent app and is not made, endorsed or
            sponsored by Strava. Maps, elevation and place names are for
            planning and reflection, not for navigation or safety decisions.
          </p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href={LEGAL_PATHS.privacy} className="underline">
              Privacy policy
            </Link>
            <Link href={LEGAL_PATHS.terms} className="underline">
              Terms of use
            </Link>
            <Link href={LEGAL_PATHS.support} className="underline">
              Support
            </Link>
          </nav>
          <p>
            © {new Date().getFullYear()} {LEGAL_OPERATOR}
          </p>
        </div>
      </footer>
    </div>
  );
}

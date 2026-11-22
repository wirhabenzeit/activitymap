import { isSuccess, runSchedule } from './jobs';
import { type D1Database, ingestTestflightCrashes } from './testflight';

interface Env {
  /** Origin of the ActivityMap deployment, e.g. https://activitymap.cc */
  ACTIVITYMAP_URL: string;
  /** Same value as the deployment's CRON_SECRET; set with `wrangler secret put`. */
  CRON_SECRET: string;
  /** TestFlight crash reports (migrations/); see docs/scheduled-jobs.md. */
  TESTFLIGHT_DB: D1Database;
  /** The app's Apple ID in App Store Connect. */
  APP_STORE_APP_ID: string;
  /** The same App Store Connect API key as the TestFlight workflow's secrets. */
  APP_STORE_CONNECT_KEY_ID?: string;
  APP_STORE_CONNECT_ISSUER_ID?: string;
  APP_STORE_CONNECT_PRIVATE_KEY?: string;
}

interface ScheduledController {
  cron: string;
  scheduledTime: number;
}

// Not exported: the runtime treats every export of the entry module as a handler.
/** Copies new TestFlight crash reports; the hourly batch runs it last. */
const TESTFLIGHT_CRON = '0 * * * *';

async function collectTestflightCrashes(env: Env): Promise<string | null> {
  const keyId = env.APP_STORE_CONNECT_KEY_ID;
  const issuerId = env.APP_STORE_CONNECT_ISSUER_ID;
  const privateKey = env.APP_STORE_CONNECT_PRIVATE_KEY;
  if (!keyId || !issuerId || !privateKey) {
    console.log(
      JSON.stringify({
        name: 'testflight-crashes',
        status: 'skipped',
        body: 'App Store Connect secrets are not set',
      }),
    );
    return null;
  }
  try {
    const result = await ingestTestflightCrashes({
      db: env.TESTFLIGHT_DB,
      appId: env.APP_STORE_APP_ID,
      credentials: { keyId, issuerId, privateKey },
    });
    console.log(
      JSON.stringify({ name: 'testflight-crashes', status: 'ok', ...result }),
    );
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      JSON.stringify({
        name: 'testflight-crashes',
        status: 'error',
        body: message,
      }),
    );
    return 'testflight-crashes (error)';
  }
}

const worker = {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const results = await runSchedule(controller.cron, {
      baseUrl: env.ACTIVITYMAP_URL,
      cronSecret: env.CRON_SECRET,
    });
    for (const result of results) {
      // Workers Logs keeps these for inspection in the Cloudflare dashboard.
      console.log(JSON.stringify({ cron: controller.cron, ...result }));
    }
    const failed = results
      .filter((result) => result.status !== 'skipped' && !isSuccess(result))
      .map((result) => `${result.name} (${result.status})`);
    if (controller.cron === TESTFLIGHT_CRON) {
      const testflightFailure = await collectTestflightCrashes(env);
      if (testflightFailure) failed.push(testflightFailure);
    }
    // A thrown error marks the invocation as failed in Cloudflare's cron history.
    if (failed.length > 0) {
      throw new Error(`Failed: ${failed.join(', ')}`);
    }
  },
};

export default worker;

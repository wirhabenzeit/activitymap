import { isSuccess, runSchedule } from './jobs';

interface Env {
  /** Origin of the ActivityMap deployment, e.g. https://activitymap.cc */
  ACTIVITYMAP_URL: string;
  /** Same value as the deployment's CRON_SECRET; set with `wrangler secret put`. */
  CRON_SECRET: string;
}

interface ScheduledController {
  cron: string;
  scheduledTime: number;
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
    const failed = results.filter(
      (result) => result.status !== 'skipped' && !isSuccess(result),
    );
    // A thrown error marks the invocation as failed in Cloudflare's cron history.
    if (failed.length > 0) {
      throw new Error(
        `Failed: ${failed.map((result) => `${result.name} (${result.status})`).join(', ')}`,
      );
    }
  },
};

export default worker;

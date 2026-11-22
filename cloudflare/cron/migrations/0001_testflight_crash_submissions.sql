-- TestFlight crash reports that testers shared, copied from App Store Connect
-- by the hourly Worker run (src/testflight.ts). Apply with:
--   pnpm dlx wrangler@4 d1 migrations apply activitymap-testflight --remote --config cloudflare/cron/wrangler.jsonc
CREATE TABLE crash_submissions (
  -- App Store Connect betaFeedbackCrashSubmissions id.
  id TEXT PRIMARY KEY,
  -- When the tester submitted the report (ISO 8601, from App Store Connect).
  created_at TEXT NOT NULL,
  build_id TEXT,
  -- CFBundleVersion of the build that crashed.
  build_number TEXT,
  app_platform TEXT,
  device_model TEXT,
  device_family TEXT,
  os_version TEXT,
  locale TEXT,
  comment TEXT,
  tester_email TEXT,
  -- Every attribute App Store Connect returned, as JSON.
  attributes TEXT NOT NULL,
  -- Parsed from the crash log for grouping; NULL when it couldn't be parsed.
  exception_type TEXT,
  crashed_frame TEXT,
  -- The full crash log, NULL until it has been downloaded.
  crash_log TEXT,
  crash_log_attempts INTEGER NOT NULL DEFAULT 0,
  crash_log_error TEXT,
  ingested_at TEXT NOT NULL
);

CREATE INDEX crash_submissions_created_at ON crash_submissions (created_at);
CREATE INDEX crash_submissions_signature ON crash_submissions (exception_type, crashed_frame);

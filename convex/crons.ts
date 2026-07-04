/**
 * Atlas cron jobs.
 *
 * Convex guideline: ONLY `crons.interval` and `crons.cron`.
 * Never `crons.daily` / `crons.weekly` — they don't exist.
 */

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

/* ============================================================ */
/* Inbox                                                          */
/* ============================================================ */

crons.interval(
  "unwind snoozed conversations",
  { minutes: 5 },
  internal.emails.unwindSnoozed,
);

/* ============================================================ */
/* Campaigns                                                      */
/* ============================================================ */

crons.interval(
  "process due campaign recipients",
  { minutes: 1 },
  internal.campaignRunner.processDueRecipients,
);

/* ============================================================ */
/* Broadcasts                                                     */
/* ============================================================ */

crons.interval(
  "trigger scheduled broadcasts",
  { minutes: 1 },
  internal.broadcastsDispatch.scanScheduled,
);

/* ============================================================ */
/* Social posts — scheduled publisher                             */
/* ============================================================ */

crons.interval(
  "publish scheduled social posts",
  { minutes: 1 },
  internal.socialActions.runScheduledPosts,
);

/* ============================================================ */
/* Trend intelligence                                             */
/* ============================================================ */

crons.interval(
  "scan brand watches for mentions",
  { hours: 6 },
  internal.trendsActions.scanDueBrandWatches,
);

/* ============================================================ */
/* Pipelines — rotting-deal health check                          */
/* ============================================================ */

crons.cron(
  "daily deal health check",
  "0 4 * * *", // 04:00 UTC = 07:00 Africa/Nairobi, every day
  internal.pipelinesActions.classifyRottingDeals,
);

/* ============================================================ */
/* Calendar — meeting reminders + pre-meeting AI brief             */
/* ============================================================ */

crons.interval(
  "send meeting reminders + AI briefs",
  { minutes: 5 },
  internal.calendarActions.sendMeetingReminders,
);

/* ============================================================ */
/* Analytics — nightly snapshot                                    */
/* ============================================================ */

crons.cron(
  "nightly analytics snapshot",
  "15 21 * * *", // 21:15 UTC = 00:15 Africa/Nairobi
  internal.analyticsActions.rollupDailySnapshots,
);

/* ============================================================ */
/* Webhooks — deliver timeline event fan-out                       */
/* ============================================================ */

crons.interval(
  "deliver pending webhook events",
  { minutes: 1 },
  internal.webhookDelivery.deliverPending,
);

/* ============================================================ */
/* DocuSeal — poll signature status                                */
/* ============================================================ */

crons.interval(
  "poll DocuSeal signature status",
  { minutes: 10 },
  internal.documentsActions.pollSignatureStatus,
);

/* ============================================================ */
/* Daily briefings — 3x/day AI paragraph for the Today page        */
/* ============================================================ */

crons.cron(
  "morning briefing",
  "0 3 * * *", // 03:00 UTC = 06:00 Africa/Nairobi
  internal.dailyBriefings.generateForAllWorkspaces,
);
crons.cron(
  "midday briefing",
  "0 9 * * *", // 09:00 UTC = 12:00 Africa/Nairobi
  internal.dailyBriefings.generateForAllWorkspaces,
);
crons.cron(
  "evening briefing",
  "0 15 * * *", // 15:00 UTC = 18:00 Africa/Nairobi
  internal.dailyBriefings.generateForAllWorkspaces,
);

export default crons;

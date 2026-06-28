/**
 * Atlas cron jobs.
 *
 * Convex guideline: ONLY `crons.interval` and `crons.cron`.
 * Never `crons.daily` / `crons.weekly` — they don't exist.
 *
 * Phases populate this file as they need scheduled work:
 *   - Phase 5: AI digest at 7am Africa/Nairobi
 *   - Phase 7b: payment reminder loop for M-PESA renewals
 *   - Phase 8: campaign step scheduler
 *   - Phase 9: meeting prep brief (1h before)
 */

import { cronJobs } from "convex/server";

const crons = cronJobs();

export default crons;

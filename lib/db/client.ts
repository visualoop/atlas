import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";

/**
 * Atlas database client — Drizzle ORM over postgres-js.
 *
 * Two connections:
 *  - `db` (pooled, transaction-mode) — for RSC reads, short queries. Default everywhere.
 *  - `dbDirect` (unpooled, session-mode) — for migrations, transactions, long-lived ops.
 *
 * In dev we cache on globalThis to survive HMR; in prod each runtime has its own pool.
 */

declare global {
  // eslint-disable-next-line no-var
  var __atlas_pg_pool: ReturnType<typeof postgres> | undefined;
  // eslint-disable-next-line no-var
  var __atlas_pg_direct: ReturnType<typeof postgres> | undefined;
}

function makePool(connectionString: string, options: postgres.Options<Record<string, never>> = {}) {
  return postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // disabled for Supabase pooler compatibility (transaction mode)
    ssl: "require",
    ...options,
  });
}

const pool = global.__atlas_pg_pool ?? makePool(env.DATABASE_URL);
const direct =
  global.__atlas_pg_direct ?? makePool(env.DATABASE_URL_UNPOOLED, { max: 5, prepare: true });

if (env.NODE_ENV !== "production") {
  global.__atlas_pg_pool = pool;
  global.__atlas_pg_direct = direct;
}

export const db = drizzle(pool);
export const dbDirect = drizzle(direct);

/** Close pools cleanly — used by scripts and tests. */
export async function closeDb() {
  await Promise.all([pool.end(), direct.end()]);
}

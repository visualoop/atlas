"use node";

/**
 * Public action to fetch AI keys for the streaming Route Handler.
 *
 * Only callable by an authenticated org member. Returns decrypted keys
 * for the caller's active org. The Next.js `/api/copilot` route uses
 * this to power the streaming agent — keys stay server-side (never
 * flow to the browser).
 *
 * Node runtime because getOrgKey decrypts secrets.
 */

import { action } from "./_generated/server";
import { internal } from "./_generated/api";

interface KeyBundle {
  groq?: string;
  cerebras?: string;
  gemini?: string;
  openai?: string;
  openrouter?: string;
}

export const chatKeysForAgent = action({
  args: {},
  handler: async (ctx): Promise<KeyBundle> => {
    // prepare() is our existing internal helper — it decrypts every
    // AI key the workspace has configured. Reusing here.
    const setup = await ctx.runQuery(internal.copilotHelpers.prepare, {});
    if (!setup) throw new Error("not_in_workspace");
    return setup.keys;
  },
});

"use node";

/**
 * WhatsApp template management — actions for submitting new templates
 * to Meta and syncing status back into whatsappTemplates.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

const META_GRAPH = "https://graph.facebook.com/v20.0";

export const submitForApproval = action({
  args: {
    name: v.string(),
    language: v.string(),
    category: v.union(
      v.literal("MARKETING"),
      v.literal("UTILITY"),
      v.literal("AUTHENTICATION"),
    ),
    bodyText: v.string(),
  },
  handler: async (ctx, args): Promise<{ status: "submitted"; externalId?: string }> => {
    const setup = await ctx.runQuery(internal.whatsappOutHelpers.prepareSend, {
      toPhone: "+000000000",
    });
    if (!setup.accessToken || !setup.connection) {
      throw new Error("WhatsApp is not connected — configure a connection first.");
    }

    const wabaId = setup.connection.wabaId;
    const res = await fetch(`${META_GRAPH}/${wabaId}/message_templates`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${setup.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: args.name,
        language: args.language,
        category: args.category,
        components: [{ type: "BODY", text: args.bodyText }],
      }),
    });
    if (!res.ok) {
      throw new Error(`Meta ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as { id?: string };

    // Store in DB with PENDING status
    await ctx.runMutation(internal.whatsapp.upsertTemplate, {
      workspaceId: setup.workspaceId,
      wabaId,
      externalTemplateId: json.id,
      name: args.name,
      language: args.language,
      category: args.category,
      status: "PENDING",
      components: [{ type: "BODY", text: args.bodyText }],
    });

    return { status: "submitted", externalId: json.id };
  },
});

export const syncFromMeta = action({
  args: {},
  handler: async (ctx): Promise<{ synced: number }> => {
    const setup = await ctx.runQuery(internal.whatsappOutHelpers.prepareSend, {
      toPhone: "+000000000",
    });
    if (!setup.accessToken || !setup.connection) {
      throw new Error("WhatsApp is not connected.");
    }
    const wabaId = setup.connection.wabaId;

    const res = await fetch(
      `${META_GRAPH}/${wabaId}/message_templates?limit=200`,
      { headers: { Authorization: `Bearer ${setup.accessToken}` } },
    );
    if (!res.ok) {
      throw new Error(`Meta ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        name: string;
        language: string;
        category: string;
        status: string;
        components: unknown;
      }>;
    };

    for (const t of json.data ?? []) {
      await ctx.runMutation(internal.whatsapp.upsertTemplate, {
        workspaceId: setup.workspaceId,
        wabaId,
        externalTemplateId: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        components: t.components,
      });
    }
    return { synced: json.data?.length ?? 0 };
  },
});

"use node";

/**
 * WhatsApp outbound — Meta Cloud API.
 *
 * Two entry points:
 *   - sendText: within-24h free-form reply. Fails at Meta side if
 *     out of window; we still persist as 'failed' so it shows up in
 *     the inbox with a helpful error.
 *   - sendTemplate: name + language + variables. Works anytime.
 *
 * Both call:
 *   POST https://graph.facebook.com/v20.0/{phone_number_id}/messages
 *
 * The org's Meta access token lives in orgIntegrationKeys under
 * provider='meta_whatsapp' (Tier-1 encrypted).
 */

import { v, ConvexError } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const META_GRAPH = "https://graph.facebook.com/v20.0";

interface SendResult {
  status: "sent" | "queued" | "failed";
  metaMessageId?: string;
  error?: string;
}

async function callMeta(args: {
  accessToken: string;
  phoneNumberId: string;
  body: Record<string, unknown>;
}): Promise<SendResult> {
  try {
    const res = await fetch(`${META_GRAPH}/${args.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args.body),
    });
    if (!res.ok) {
      const err = await res.text();
      return { status: "failed", error: `Meta ${res.status}: ${err.slice(0, 200)}` };
    }
    const json = (await res.json()) as {
      messages?: Array<{ id: string; message_status?: string }>;
    };
    const metaId = json.messages?.[0]?.id;
    return { status: "sent", metaMessageId: metaId };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

/* ------------------------------------------------------------------ */
/* sendText — within 24h                                                */
/* ------------------------------------------------------------------ */

export const sendText = action({
  args: {
    conversationId: v.optional(v.id("conversations")),
    toPhone: v.string(),                                          // E.164, with +
    bodyText: v.string(),
    contactId: v.optional(v.id("contacts")),
  },
  handler: async (ctx, args): Promise<{
    conversationId: Id<"conversations">;
    messageId: Id<"messages">;
    status: SendResult["status"];
    error?: string;
  }> => {
    const setup = await ctx.runQuery(internal.whatsappOutHelpers.prepareSend, {
      conversationId: args.conversationId,
      toPhone: args.toPhone,
    });

    if (!setup.accessToken || !setup.connection) {
      throw new ConvexError({
        code: "NO_CONNECTION",
        message: "WhatsApp is not connected for this workspace.",
      });
    }

    const to = args.toPhone.replace(/^\+/, "");

    let result: SendResult = { status: "queued" };
    if (setup.accessToken) {
      result = await callMeta({
        accessToken: setup.accessToken,
        phoneNumberId: setup.connection.phoneNumberId,
        body: {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: args.bodyText },
        },
      });
    }

    const persisted: {
      conversationId: Id<"conversations">;
      messageId: Id<"messages">;
    } = await ctx.runMutation(internal.whatsapp.persistOutboundMessage, {
      workspaceId: setup.workspaceId,
      conversationId: args.conversationId,
      toPhone: args.toPhone,
      contactId: args.contactId,
      bodyText: args.bodyText,
      messageType: "text",
      metaMessageId: result.metaMessageId,
      status: result.status,
      failureReason: result.error,
      actorId: setup.userId,
    });

    return { ...persisted, status: result.status, error: result.error };
  },
});

/* ------------------------------------------------------------------ */
/* sendTemplate — outside 24h window                                   */
/* ------------------------------------------------------------------ */

export const sendTemplate = action({
  args: {
    toPhone: v.string(),
    templateName: v.string(),
    templateLanguage: v.optional(v.string()),                    // 'en' by default
    variables: v.optional(v.array(v.string())),                  // positional: {{1}} {{2}} …
    conversationId: v.optional(v.id("conversations")),
    contactId: v.optional(v.id("contacts")),
  },
  handler: async (ctx, args): Promise<{
    conversationId: Id<"conversations">;
    messageId: Id<"messages">;
    status: SendResult["status"];
    error?: string;
  }> => {
    const setup = await ctx.runQuery(internal.whatsappOutHelpers.prepareSend, {
      conversationId: args.conversationId,
      toPhone: args.toPhone,
    });

    if (!setup.accessToken || !setup.connection) {
      throw new ConvexError({
        code: "NO_CONNECTION",
        message: "WhatsApp is not connected for this workspace.",
      });
    }

    const to = args.toPhone.replace(/^\+/, "");
    const lang = args.templateLanguage ?? "en";

    const templateBody: Record<string, unknown> = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: args.templateName,
        language: { code: lang },
        components: args.variables?.length
          ? [
              {
                type: "body",
                parameters: args.variables.map((v) => ({ type: "text", text: v })),
              },
            ]
          : undefined,
      },
    };

    const result = await callMeta({
      accessToken: setup.accessToken,
      phoneNumberId: setup.connection.phoneNumberId,
      body: templateBody,
    });

    // Fill template preview from variables so the message body is readable in-inbox
    const bodyText = args.variables?.length
      ? `[Template: ${args.templateName}] ${args.variables.join(" ")}`
      : `[Template: ${args.templateName}]`;

    const persisted: {
      conversationId: Id<"conversations">;
      messageId: Id<"messages">;
    } = await ctx.runMutation(internal.whatsapp.persistOutboundMessage, {
      workspaceId: setup.workspaceId,
      conversationId: args.conversationId,
      toPhone: args.toPhone,
      contactId: args.contactId,
      bodyText,
      messageType: "template",
      templateName: args.templateName,
      templateLanguage: lang,
      metaMessageId: result.metaMessageId,
      status: result.status,
      failureReason: result.error,
      actorId: setup.userId,
    });

    return { ...persisted, status: result.status, error: result.error };
  },
});

/* ------------------------------------------------------------------ */
/* sendTemplateSystem — session-less template send (for campaigns)     */
/* ------------------------------------------------------------------ */

import { internalAction } from "./_generated/server";

export const sendTemplateSystem = internalAction({
  args: {
    workspaceId: v.id("workspaces"),
    organizationId: v.id("organizations"),
    toPhone: v.string(),
    templateName: v.string(),
    templateLanguage: v.optional(v.string()),
    variables: v.optional(v.array(v.string())),
    contactId: v.id("contacts"),
  },
  handler: async (ctx, args): Promise<{
    conversationId: Id<"conversations">;
    messageId: Id<"messages">;
    status: SendResult["status"];
    error?: string;
  }> => {
    const setup = await ctx.runQuery(internal.whatsappOutHelpers.prepareSystemSend, {
      workspaceId: args.workspaceId,
      organizationId: args.organizationId,
    });

    if (!setup.accessToken || !setup.connection) {
      throw new ConvexError({
        code: "NO_CONNECTION",
        message: "WhatsApp is not connected for this workspace.",
      });
    }

    const to = args.toPhone.replace(/^\+/, "");
    const lang = args.templateLanguage ?? "en";

    const templateBody: Record<string, unknown> = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: args.templateName,
        language: { code: lang },
        components: args.variables?.length
          ? [
              {
                type: "body",
                parameters: args.variables.map((v) => ({ type: "text", text: v })),
              },
            ]
          : undefined,
      },
    };

    const result = await callMeta({
      accessToken: setup.accessToken,
      phoneNumberId: setup.connection.phoneNumberId,
      body: templateBody,
    });

    const bodyText = args.variables?.length
      ? `[Template: ${args.templateName}] ${args.variables.join(" ")}`
      : `[Template: ${args.templateName}]`;

    const persisted: {
      conversationId: Id<"conversations">;
      messageId: Id<"messages">;
    } = await ctx.runMutation(internal.whatsapp.persistOutboundMessage, {
      workspaceId: args.workspaceId,
      toPhone: args.toPhone,
      contactId: args.contactId,
      bodyText,
      messageType: "template",
      templateName: args.templateName,
      templateLanguage: lang,
      metaMessageId: result.metaMessageId,
      status: result.status,
      failureReason: result.error,
    });

    return { ...persisted, status: result.status, error: result.error };
  },
});

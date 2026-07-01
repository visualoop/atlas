"use node";

/**
 * Demo-recording transcript + AI summary via Groq Whisper.
 *
 * Flow:
 *   1. User uploads a video file via /calendar Trials tab.
 *   2. Frontend calls this action with the storage id.
 *   3. Groq's whisper-large-v3 transcribes.
 *   4. llama-3.3-70b generates summary + questions + action items.
 *   5. Results stored on demoRecordings row.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

export const transcribeDemoRecording = action({
  args: {
    demoRecordingId: v.id("demoRecordings"),
  },
  handler: async (ctx, args): Promise<{ transcript: string; summary?: string }> => {
    const setup = await ctx.runQuery(internal.demoRecordingsHelpers.prepare, {
      demoRecordingId: args.demoRecordingId,
    });
    if (!setup.apiKey) throw new Error("Groq API key not configured.");
    if (!setup.storageId) throw new Error("No video file attached.");

    const url = await ctx.storage.getUrl(setup.storageId);
    if (!url) throw new Error("Could not resolve video URL.");

    // Download file
    const videoRes = await fetch(url);
    if (!videoRes.ok) throw new Error(`Failed to fetch video: ${videoRes.status}`);
    const videoBlob = await videoRes.blob();

    // Transcribe via Groq whisper-large-v3
    const form = new FormData();
    form.append("file", videoBlob, "recording.webm");
    form.append("model", "whisper-large-v3");
    form.append("response_format", "text");
    form.append("language", "en");

    const trRes = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${setup.apiKey}` },
        body: form,
      },
    );
    if (!trRes.ok) {
      throw new Error(`Whisper ${trRes.status}: ${(await trRes.text()).slice(0, 200)}`);
    }
    const transcript = (await trRes.text()).trim();

    // Generate summary + questions
    let summary: string | undefined;
    let questions: string[] = [];
    let actionItems: string[] = [];
    try {
      const chatRes = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${setup.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              {
                role: "system",
                content:
                  "You are analyzing a sales demo transcript. Return only JSON.",
              },
              {
                role: "user",
                content: `Transcript:\n${transcript.slice(0, 12000)}\n\nReturn JSON: { "summary": "3-4 sentence executive summary", "questions": ["list of questions the prospect asked"], "actionItems": ["list of follow-up items"] }`,
              },
            ],
            temperature: 0.2,
            max_tokens: 1500,
            response_format: { type: "json_object" },
          }),
        },
      );
      if (chatRes.ok) {
        const j = (await chatRes.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}") as {
          summary?: string;
          questions?: string[];
          actionItems?: string[];
        };
        summary = parsed.summary;
        questions = Array.isArray(parsed.questions) ? parsed.questions : [];
        actionItems = Array.isArray(parsed.actionItems) ? parsed.actionItems : [];
      }
    } catch {
      // fall through — transcript still saved
    }

    await ctx.runMutation(internal.demoRecordingsHelpers.saveTranscript, {
      demoRecordingId: args.demoRecordingId,
      transcript,
      summary,
      questions,
      actionItems,
    });

    return { transcript, summary };
  },
});

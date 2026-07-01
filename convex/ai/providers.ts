/**
 * Provider HTTP callers — one function per provider, normalizing to
 * a common { text, inputTokens, outputTokens } response shape.
 *
 * Each caller is a plain async function that takes { apiKey, model,
 * messages, maxTokens, temperature } and hits the provider's REST
 * endpoint. Runs in the Node runtime (called from ai/gateway.ts
 * which is a "use node" action).
 */

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CallArgs {
  apiKey: string;
  model: string;
  messages: AIMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface CallResult {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

/* ------------------------------------------------------------------ */
/* Gemini (Google AI Studio, generativelanguage.googleapis.com)         */
/* ------------------------------------------------------------------ */

export async function callGemini(args: CallArgs): Promise<CallResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${args.model}:generateContent?key=${args.apiKey}`;
  // Gemini uses a different message format — role: 'user' | 'model'
  const contents = args.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  const systemInstruction = args.messages.find((m) => m.role === "system");

  const body = {
    contents,
    ...(systemInstruction
      ? { systemInstruction: { parts: [{ text: systemInstruction.content }] } }
      : {}),
    generationConfig: {
      maxOutputTokens: args.maxTokens ?? 1000,
      temperature: args.temperature ?? 0.4,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") ?? "";
  return {
    text,
    inputTokens: json.usageMetadata?.promptTokenCount,
    outputTokens: json.usageMetadata?.candidatesTokenCount,
  };
}

/* ------------------------------------------------------------------ */
/* Groq — OpenAI-compatible                                              */
/* ------------------------------------------------------------------ */

export async function callGroq(args: CallArgs): Promise<CallResult> {
  return await openAICompatible({
    ...args,
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
  });
}

export async function callCerebras(args: CallArgs): Promise<CallResult> {
  return await openAICompatible({
    ...args,
    endpoint: "https://api.cerebras.ai/v1/chat/completions",
  });
}

export async function callOpenRouter(args: CallArgs): Promise<CallResult> {
  return await openAICompatible({
    ...args,
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    extraHeaders: {
      "HTTP-Referer": process.env.SITE_URL ?? "https://atlas.blyss.co.ke",
      "X-Title": "Atlas",
    },
  });
}

export async function callOpenAI(args: CallArgs): Promise<CallResult> {
  return await openAICompatible({
    ...args,
    endpoint: "https://api.openai.com/v1/chat/completions",
  });
}

export async function callMistral(args: CallArgs): Promise<CallResult> {
  return await openAICompatible({
    ...args,
    endpoint: "https://api.mistral.ai/v1/chat/completions",
  });
}

export async function callTogether(args: CallArgs): Promise<CallResult> {
  return await openAICompatible({
    ...args,
    endpoint: "https://api.together.xyz/v1/chat/completions",
  });
}

export async function callGithubModels(args: CallArgs): Promise<CallResult> {
  return await openAICompatible({
    ...args,
    endpoint: "https://models.inference.ai.azure.com/chat/completions",
  });
}

/* ------------------------------------------------------------------ */
/* Anthropic — different message envelope                                */
/* ------------------------------------------------------------------ */

export async function callAnthropic(args: CallArgs): Promise<CallResult> {
  const system = args.messages.find((m) => m.role === "system")?.content;
  const conversation = args.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  const body: Record<string, unknown> = {
    model: args.model,
    max_tokens: args.maxTokens ?? 1024,
    temperature: args.temperature ?? 0.4,
    messages: conversation,
  };
  if (system) body.system = system;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": args.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = json.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "";
  return {
    text,
    inputTokens: json.usage?.input_tokens,
    outputTokens: json.usage?.output_tokens,
  };
}

/* ------------------------------------------------------------------ */
/* Cohere — chat endpoint (v2)                                          */
/* ------------------------------------------------------------------ */

export async function callCohere(args: CallArgs): Promise<CallResult> {
  const res = await fetch("https://api.cohere.ai/v2/chat", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages.map((m) => ({
        role: m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user",
        content: m.content,
      })),
      max_tokens: args.maxTokens ?? 1024,
      temperature: args.temperature ?? 0.4,
    }),
  });
  if (!res.ok) throw new Error(`Cohere ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as {
    message?: { content?: Array<{ text?: string }> };
    usage?: { tokens?: { input_tokens?: number; output_tokens?: number } };
  };
  const text = json.message?.content?.map((c) => c.text ?? "").join("") ?? "";
  return {
    text,
    inputTokens: json.usage?.tokens?.input_tokens,
    outputTokens: json.usage?.tokens?.output_tokens,
  };
}

/* ------------------------------------------------------------------ */
/* OpenAI-compatible helper                                              */
/* ------------------------------------------------------------------ */

async function openAICompatible(args: CallArgs & {
  endpoint: string;
  extraHeaders?: Record<string, string>;
}): Promise<CallResult> {
  const res = await fetch(args.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
      ...(args.extraHeaders ?? {}),
    },
    body: JSON.stringify({
      model: args.model,
      messages: args.messages,
      max_tokens: args.maxTokens ?? 1024,
      temperature: args.temperature ?? 0.4,
    }),
  });
  if (!res.ok) {
    throw new Error(`${new URL(args.endpoint).host} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  return {
    text,
    inputTokens: json.usage?.prompt_tokens,
    outputTokens: json.usage?.completion_tokens,
  };
}

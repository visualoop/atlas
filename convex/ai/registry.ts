/**
 * AI provider registry + default feature-model bindings.
 *
 * A "chain" is an ordered list of (provider, model) pairs. The
 * gateway walks the chain top-to-bottom and stops at the first one
 * that returns a valid response. Every chain ends with
 * `openrouter/free` as the universal safety net.
 *
 * Providers not listed here (like Vertex, Together AI) can still be
 * called via aiFeatureBindings if the workspace configures them.
 *
 * NOTE: workspace admins override any of these via aiFeatureBindings
 * from Settings → AI (Phase 5 follow-up).
 */

export type ProviderId =
  | "gemini"
  | "groq"
  | "openrouter"
  | "mistral"
  | "cohere"
  | "cerebras"
  | "github_models"
  | "openai"
  | "anthropic"
  | "together";

export interface ChainStep {
  provider: ProviderId;
  model: string;
  maxTokens?: number;
  temperature?: number;
  tools?: string[];
}

export interface AIFeature {
  id: string;
  label: string;
  description: string;
  defaultChain: ChainStep[];
}

/* ------------------------------------------------------------------ */
/* Shortcuts for chain tails                                             */
/* ------------------------------------------------------------------ */

// Universal free safety-net — must always be last in a chain.
const FREE_ROUTER_SAFETY: ChainStep = {
  provider: "openrouter",
  model: "openrouter/auto",       // free tier acts as universal fallback
  temperature: 0.4,
  maxTokens: 2000,
};

/* ------------------------------------------------------------------ */
/* Features                                                              */
/* ------------------------------------------------------------------ */

export const AI_FEATURES: Record<string, AIFeature> = {
  /* Email drafting — cheap + fast + long context */
  draft_email_reply: {
    id: "draft_email_reply",
    label: "Draft email reply",
    description: "Given the thread history + context, produce a reply draft.",
    defaultChain: [
      { provider: "gemini", model: "gemini-2.0-flash-exp", temperature: 0.5, maxTokens: 1500 },
      { provider: "groq", model: "llama-3.3-70b-versatile", temperature: 0.5, maxTokens: 1500 },
      { provider: "cerebras", model: "llama-4-scout-17b-16e-instruct", temperature: 0.5, maxTokens: 1500 },
      FREE_ROUTER_SAFETY,
    ],
  },

  /* WhatsApp reply — short, tone-preserving */
  draft_whatsapp_reply: {
    id: "draft_whatsapp_reply",
    label: "Draft WhatsApp reply",
    description: "Short, casual reply for WhatsApp.",
    defaultChain: [
      { provider: "groq", model: "llama-3.3-70b-versatile", temperature: 0.6, maxTokens: 400 },
      { provider: "gemini", model: "gemini-2.0-flash-exp", temperature: 0.6, maxTokens: 400 },
      { provider: "cerebras", model: "llama-4-scout-17b-16e-instruct", temperature: 0.6, maxTokens: 400 },
      FREE_ROUTER_SAFETY,
    ],
  },

  /* Thread summarization */
  summarize_thread: {
    id: "summarize_thread",
    label: "Summarize conversation",
    description: "3-sentence summary + the outstanding question.",
    defaultChain: [
      { provider: "gemini", model: "gemini-2.0-flash-exp", temperature: 0.2, maxTokens: 400 },
      { provider: "groq", model: "llama-3.3-70b-versatile", temperature: 0.2, maxTokens: 400 },
      FREE_ROUTER_SAFETY,
    ],
  },

  /* Lead fit score (Prospector) */
  fit_score_lead: {
    id: "fit_score_lead",
    label: "Score a lead's fit",
    description: "Returns { score: 0-100, reasoning: string }.",
    defaultChain: [
      { provider: "gemini", model: "gemini-2.0-flash-exp", temperature: 0.1, maxTokens: 300 },
      { provider: "groq", model: "llama-3.3-70b-versatile", temperature: 0.1, maxTokens: 300 },
      FREE_ROUTER_SAFETY,
    ],
  },

  /* Website enrichment (Prospector) */
  enrich_website: {
    id: "enrich_website",
    label: "Extract company details from a website",
    description: "Given a URL's HTML, return { email, phone, description, socials }.",
    defaultChain: [
      { provider: "gemini", model: "gemini-2.0-flash-exp", temperature: 0.0, maxTokens: 600 },
      { provider: "groq", model: "llama-3.3-70b-versatile", temperature: 0.0, maxTokens: 600 },
      FREE_ROUTER_SAFETY,
    ],
  },

  /* Document generation — proposals, quotes, contracts */
  generate_document: {
    id: "generate_document",
    label: "Generate document body",
    description: "Given deal + contact context + a brief, produce structured document body.",
    defaultChain: [
      { provider: "gemini", model: "gemini-2.0-flash-exp", temperature: 0.3, maxTokens: 3000 },
      { provider: "groq", model: "llama-3.3-70b-versatile", temperature: 0.3, maxTokens: 3000 },
      FREE_ROUTER_SAFETY,
    ],
  },

  /* Critique document — anti-slop review before send */
  critique_document: {
    id: "critique_document",
    label: "Critique a document",
    description: "Review for tone, clarity, and slop patterns. Return issues list.",
    defaultChain: [
      { provider: "gemini", model: "gemini-2.0-flash-exp", temperature: 0.1, maxTokens: 1500 },
      { provider: "groq", model: "llama-3.3-70b-versatile", temperature: 0.1, maxTokens: 1500 },
      FREE_ROUTER_SAFETY,
    ],
  },

  /* Cold email draft — first-touch outreach with JSON output */
  draft_cold_email: {
    id: "draft_cold_email",
    label: "Draft cold email",
    description: "First-touch outreach email. Returns JSON { subject, body }.",
    defaultChain: [
      { provider: "gemini", model: "gemini-2.0-flash-exp", temperature: 0.6, maxTokens: 800 },
      { provider: "groq", model: "llama-3.3-70b-versatile", temperature: 0.6, maxTokens: 800 },
      { provider: "cerebras", model: "llama-4-scout-17b-16e-instruct", temperature: 0.6, maxTokens: 800 },
      FREE_ROUTER_SAFETY,
    ],
  },

  /* Cold WhatsApp draft — short, casual opener */
  draft_cold_whatsapp: {
    id: "draft_cold_whatsapp",
    label: "Draft cold WhatsApp",
    description: "Short first-touch WhatsApp opener. Plain text, casual voice.",
    defaultChain: [
      { provider: "groq", model: "llama-3.3-70b-versatile", temperature: 0.7, maxTokens: 300 },
      { provider: "gemini", model: "gemini-2.0-flash-exp", temperature: 0.7, maxTokens: 300 },
      { provider: "cerebras", model: "llama-4-scout-17b-16e-instruct", temperature: 0.7, maxTokens: 300 },
      FREE_ROUTER_SAFETY,
    ],
  },

  /* Generic JSON extraction — fit scoring, deal analysis, etc */
  extract_json: {
    id: "extract_json",
    label: "Extract structured JSON",
    description: "Return strict JSON for scoring, classification, extraction tasks.",
    defaultChain: [
      { provider: "gemini", model: "gemini-2.0-flash-exp", temperature: 0.1, maxTokens: 800 },
      { provider: "groq", model: "llama-3.3-70b-versatile", temperature: 0.1, maxTokens: 800 },
      FREE_ROUTER_SAFETY,
    ],
  },
};

export function getDefaultChain(featureId: string): ChainStep[] {
  const feature = AI_FEATURES[featureId];
  if (!feature) throw new Error(`Unknown AI feature: ${featureId}`);
  return feature.defaultChain;
}

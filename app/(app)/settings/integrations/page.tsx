"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import Link from "next/link";
import {
  X, Check, Loader2, KeyRound, RotateCw, Trash2, ExternalLink,
  Sparkles, Mail, MessageSquare, CreditCard, Map, FileSignature,
  Database, Zap, Cloud, TestTube,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type Provider =
  | "gemini" | "groq" | "openrouter" | "mistral" | "cohere" | "cerebras"
  | "github_models" | "openai" | "anthropic" | "together"
  | "deepseek" | "xai" | "perplexity" | "google_vertex"
  | "resend" | "meta_whatsapp" | "cloudflare_email_routing"
  | "google_maps_places" | "geoapify" | "paystack" | "docuseal" | "composio";

interface ProviderInfo {
  id: Provider;
  name: string;
  category: string;
  description: string;
  signupUrl: string;
  docsUrl: string;
  keyFormatHint?: string;
  deepLink?: string; // per-integration setup page
  icon: React.ComponentType<{ className?: string }>;
  tier: "free" | "paid" | "freemium";
}

const PROVIDERS: ProviderInfo[] = [
  // AI
  { id: "gemini", name: "Google Gemini", category: "AI", description: "Free 1M-context Flash for drafting + summarization", signupUrl: "https://aistudio.google.com/apikey", docsUrl: "https://ai.google.dev/gemini-api/docs", keyFormatHint: "starts with AIzaSy…", icon: Sparkles, tier: "free" },
  { id: "groq", name: "Groq", category: "AI", description: "30 RPM fast inference, includes Compound with web search + code + browser", signupUrl: "https://console.groq.com/keys", docsUrl: "https://console.groq.com/docs", keyFormatHint: "starts with gsk_…", icon: Sparkles, tier: "free" },
  { id: "openrouter", name: "OpenRouter", category: "AI", description: "Many models one key, includes free-tier auto router as universal fallback", signupUrl: "https://openrouter.ai/keys", docsUrl: "https://openrouter.ai/docs", keyFormatHint: "starts with sk-or-…", icon: Sparkles, tier: "freemium" },
  { id: "mistral", name: "Mistral", category: "AI", description: "Free tier with phone verification, strong European models", signupUrl: "https://console.mistral.ai/api-keys", docsUrl: "https://docs.mistral.ai", icon: Sparkles, tier: "free" },
  { id: "cohere", name: "Cohere", category: "AI", description: "Embeddings + rerank for search + AI Q&A", signupUrl: "https://dashboard.cohere.com/api-keys", docsUrl: "https://docs.cohere.com", icon: Sparkles, tier: "free" },
  { id: "cerebras", name: "Cerebras", category: "AI", description: "Free fast inference, best for latency-sensitive drafts", signupUrl: "https://cloud.cerebras.ai", docsUrl: "https://inference-docs.cerebras.ai", icon: Sparkles, tier: "free" },
  { id: "github_models", name: "GitHub Models", category: "AI", description: "Free with a GitHub account, useful as extra fallback", signupUrl: "https://github.com/marketplace/models", docsUrl: "https://docs.github.com/en/github-models", icon: Sparkles, tier: "free" },
  { id: "openai", name: "OpenAI", category: "AI", description: "Paid; add when you need GPT-5 or o-series reasoning", signupUrl: "https://platform.openai.com/api-keys", docsUrl: "https://platform.openai.com/docs", keyFormatHint: "starts with sk-…", icon: Sparkles, tier: "paid" },
  { id: "anthropic", name: "Anthropic", category: "AI", description: "Paid; add for Claude when tasks need long-form reasoning", signupUrl: "https://console.anthropic.com/settings/keys", docsUrl: "https://docs.anthropic.com", keyFormatHint: "starts with sk-ant-…", icon: Sparkles, tier: "paid" },
  { id: "together", name: "Together AI", category: "AI", description: "Paid; extra fallback tier", signupUrl: "https://api.together.xyz/settings/api-keys", docsUrl: "https://docs.together.ai", icon: Sparkles, tier: "paid" },
  { id: "deepseek", name: "DeepSeek", category: "AI", description: "DeepSeek-V3 + DeepSeek-Reasoner — deep reasoning on affordable pricing", signupUrl: "https://platform.deepseek.com/api_keys", docsUrl: "https://platform.deepseek.com/docs", keyFormatHint: "starts with sk-…", icon: Sparkles, tier: "paid" },
  { id: "xai", name: "xAI (Grok)", category: "AI", description: "Grok-4 with real-time X data + web browsing", signupUrl: "https://console.x.ai", docsUrl: "https://docs.x.ai", keyFormatHint: "starts with xai-…", icon: Sparkles, tier: "paid" },
  { id: "perplexity", name: "Perplexity", category: "AI", description: "Sonar API — web search + citations built into every response", signupUrl: "https://www.perplexity.ai/settings/api", docsUrl: "https://docs.perplexity.ai", keyFormatHint: "starts with pplx-…", icon: Sparkles, tier: "paid" },
  { id: "google_vertex", name: "Google Vertex AI", category: "AI", description: "GCP-hosted Gemini + Model Optimizer for enterprise", signupUrl: "https://console.cloud.google.com/vertex-ai", docsUrl: "https://cloud.google.com/vertex-ai/docs", keyFormatHint: "Service account JSON or access token", icon: Sparkles, tier: "paid" },

  // Email
  { id: "resend", name: "Resend", category: "Email", description: "Workspace outbound email + inbound webhook. System auth OTP uses a separate env-level key.", signupUrl: "https://resend.com/api-keys", docsUrl: "https://resend.com/docs", keyFormatHint: "starts with re_…", deepLink: "/settings/senders", icon: Mail, tier: "freemium" },
  { id: "cloudflare_email_routing", name: "Cloudflare Email Routing", category: "Email", description: "Free inbound-only forwarding — pairs with Resend for two-way mail. Token needs Email Routing Rules + Addresses (Edit) + Zone.DNS (Read).", signupUrl: "https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=%5B%7B%22key%22%3A%22email_routing_addresses%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22email_routing_rules%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22zone%22%2C%22type%22%3A%22read%22%7D%5D&name=Atlas%20Email%20Routing", docsUrl: "https://developers.cloudflare.com/email-routing/get-started/enable-email-routing/", keyFormatHint: "Cloudflare API token (long string)", deepLink: "/settings/email-routing", icon: Cloud, tier: "free" },

  // Messaging
  { id: "meta_whatsapp", name: "Meta WhatsApp Cloud", category: "Messaging", description: "Direct Meta Cloud API — no BSP fees. Set up phone numbers in the dedicated page.", signupUrl: "https://business.facebook.com", docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api", keyFormatHint: "System user access token (long string)", deepLink: "/settings/whatsapp", icon: MessageSquare, tier: "paid" },

  // Lead gen
  { id: "google_maps_places", name: "Google Maps Places", category: "Lead gen", description: "Powers Prospector — search businesses by category + location", signupUrl: "https://console.cloud.google.com/apis/credentials", docsUrl: "https://developers.google.com/maps/documentation/places/web-service", keyFormatHint: "starts with AIzaSy…", deepLink: "/prospector", icon: Map, tier: "paid" },
  { id: "geoapify", name: "Geoapify Places", category: "Lead gen", description: "3000 requests/day free — same OSM business data as OpenStreetMap but with dedicated infrastructure so no shared rate limits. Recommended over OSM-only mode.", signupUrl: "https://myprojects.geoapify.com/", docsUrl: "https://apidocs.geoapify.com/docs/places/", keyFormatHint: "32-char hex string", deepLink: "/prospector", icon: Map, tier: "free" },

  // Payments
  { id: "paystack", name: "Paystack", category: "Payments", description: "Card, mobile money, bank transfer; webhooks land in Atlas via HMAC-SHA512", signupUrl: "https://dashboard.paystack.com/#/settings/developers", docsUrl: "https://paystack.com/docs/api", keyFormatHint: "sk_live_… or sk_test_…", icon: CreditCard, tier: "paid" },

  // Docs
  { id: "docuseal", name: "DocuSeal", category: "Documents", description: "Self-hosted or cloud e-signature; wire once for contract signing", signupUrl: "https://www.docuseal.com/console", docsUrl: "https://www.docuseal.com/docs/api", icon: FileSignature, tier: "freemium" },

  // Automation hub — Composio (1000+ apps via one API key)
  { id: "composio", name: "Composio", category: "Automation", description: "Slack, Notion, GitHub, HubSpot, Airtable, X, TikTok, YouTube — 1000+ apps via one API key. Powers /automations composio nodes.", signupUrl: "https://app.composio.dev/developers", docsUrl: "https://docs.composio.dev", keyFormatHint: "starts with comp_…", deepLink: "/automations", icon: Zap, tier: "freemium" },
];

const CATEGORIES = ["AI", "Email", "Messaging", "Lead gen", "Payments", "Documents", "Automation"];

interface KeyRow {
  _id: Id<"orgIntegrationKeys">;
  provider: string;
  label: string;
  lastFour: string;
  status: string;
  keyVersion: number;
}

// ...

export default function IntegrationsPage() {
  const keys = useQuery(api.integrations.list, {});
  const [openProvider, setOpenProvider] = useState<Provider | null>(null);

  const keyByProvider = useMemo(() => {
    const map: Partial<Record<Provider, KeyRow>> = {};
    if (!keys) return map;
    for (const k of keys) {
      if (k.label === "Primary" && k.status === "active") {
        map[k.provider as Provider] = k as KeyRow;
      }
    }
    return map;
  }, [keys]);

  const setKeys = Object.keys(keyByProvider).length;
  const totalKeys = PROVIDERS.length;

  return (
    <>
      <div className="space-y-10">
        <header className="space-y-2">
          <p className="text-sm text-muted-foreground max-w-prose">
            Every integration Atlas can use. Keys are AES-GCM encrypted at rest, scoped per
            organization, and never returned to the browser after saving — only the last 4
            characters are shown. Only org admins can add or rotate.
          </p>
          <div className="flex items-center gap-3 pt-2">
            <span className="eyebrow text-muted-foreground">Progress</span>
            <div className="flex-1 max-w-xs h-1 bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(setKeys / totalKeys) * 100}%` }}
              />
            </div>
            <span className="text-xs font-mono num text-muted-foreground">
              {setKeys}/{totalKeys}
            </span>
          </div>
        </header>

        {CATEGORIES.map((category) => {
          const items = PROVIDERS.filter((p) => p.category === category);
          if (items.length === 0) return null;
          return (
            <section key={category} className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="eyebrow">{category}</p>
                <span className="text-xs text-muted-foreground font-mono">
                  {items.filter((p) => keyByProvider[p.id]).length}/{items.length}
                </span>
              </div>
              <div className="border border-border divide-y divide-border">
                {items.map((p) => {
                  const key = keyByProvider[p.id];
                  const Icon = p.icon;
                  return (
                    <div key={p.id} className="flex items-start px-4 py-4 gap-4">
                      <div className="size-9 border border-border grid place-items-center shrink-0 text-muted-foreground">
                        <Icon className="size-4" />
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <p className="text-sm font-medium">{p.name}</p>
                          <TierBadge tier={p.tier} />
                          {key ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.12em] text-[var(--success)]">
                              <Check className="size-3" /> Set · ••••{key.lastFour}
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                              Not set
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{p.description}</p>
                        <div className="flex items-center gap-3 text-[11px] pt-1">
                          <a
                            href={p.signupUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1"
                          >
                            Get key <ExternalLink className="size-2.5" />
                          </a>
                          <a
                            href={p.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                          >
                            Docs <ExternalLink className="size-2.5" />
                          </a>
                          {p.deepLink && (
                            <Link
                              href={p.deepLink}
                              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                            >
                              {key ? "Manage" : "Setup"} <ExternalLink className="size-2.5" />
                            </Link>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {key && (
                          <TestButton provider={p.id} />
                        )}
                        <button
                          onClick={() => setOpenProvider(p.id)}
                          className="font-mono uppercase tracking-[0.12em] text-xs px-3 h-8 border border-[var(--border-strong)] hover:border-foreground hover:bg-muted transition-colors"
                        >
                          {key ? "Rotate" : "Add key"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        {/* System-level env vars notice */}
        <section className="border border-dashed border-border p-5 space-y-2">
          <p className="eyebrow">System-level (Convex env vars)</p>
          <p className="text-xs text-muted-foreground">
            These aren't per-org, they live in the Convex backend env. Set them at
            <a href="https://convex.atlas.blyss.co.ke" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline mx-1">
              convex.atlas.blyss.co.ke
            </a>
            → Settings → Environment Variables.
          </p>
          <ul className="text-xs text-muted-foreground space-y-1 pt-2">
            <li><code className="font-mono">RESEND_API_KEY</code> — auth OTP + platform emails</li>
            <li><code className="font-mono">AUTH_FROM_EMAIL</code> — sender for platform emails</li>
            <li><code className="font-mono">CONFIG_ENCRYPTION_KEY</code> — never rotate without a migration</li>
            <li><code className="font-mono">SITE_URL</code>, <code className="font-mono">JWT_PRIVATE_KEY</code>, <code className="font-mono">JWKS</code> — auto-seeded by deploy</li>
            <li><code className="font-mono">REFERRAL_REWARD_CENTS</code> — optional override (default 50000 = KES 500)</li>
            <li><code className="font-mono">RESEND_INBOUND_SECRET</code>, <code className="font-mono">WHATSAPP_APP_SECRET</code> — webhook signature verification</li>
          </ul>
        </section>
      </div>

      {openProvider && (
        <ProviderKeyDialog
          provider={openProvider}
          providerInfo={PROVIDERS.find((p) => p.id === openProvider)!}
          existing={keyByProvider[openProvider] ?? null}
          onClose={() => setOpenProvider(null)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function TierBadge({ tier }: { tier: "free" | "paid" | "freemium" }) {
  const styles = {
    free: "text-[var(--success)] border-[var(--success)]",
    paid: "text-[var(--warning)] border-[var(--warning)]",
    freemium: "text-[var(--info)] border-[var(--info)]",
  };
  return (
    <span className={cn(
      "text-[9px] font-mono uppercase tracking-[0.12em] border px-1.5 py-[1px]",
      styles[tier],
    )}>
      {tier}
    </span>
  );
}

function TestButton({ provider }: { provider: Provider }) {
  const testKey = useAction(api.integrationsTests.testProvider);
  const [busy, setBusy] = useState(false);
  async function test() {
    setBusy(true);
    try {
      const res = await testKey({ provider });
      if (res.ok) toast.success(`${provider} works: ${res.detail ?? "OK"}`);
      else toast.error(`${provider} failed: ${res.detail ?? "unknown"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      onClick={test}
      disabled={busy}
      title="Test connection"
      className="size-8 grid place-items-center text-muted-foreground hover:text-primary hover:bg-muted transition-colors disabled:opacity-50"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <TestTube className="size-3.5" />}
    </button>
  );
}

function ProviderKeyDialog({
  provider, providerInfo, existing, onClose,
}: {
  provider: Provider;
  providerInfo: ProviderInfo;
  existing: { _id: Id<"orgIntegrationKeys">; lastFour: string; keyVersion: number } | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const setKey = useMutation(api.integrations.setKey);
  const revokeKey = useMutation(api.integrations.revokeKey);

  async function submit() {
    if (value.trim().length < 8) {
      toast.error("Key looks too short.");
      return;
    }
    setSaving(true);
    try {
      await setKey({ provider, value: value.trim() });
      toast.success(existing ? "Rotated." : "Saved.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  async function revoke() {
    if (!existing) return;
    if (!window.confirm(`Revoke the ${providerInfo.name} key? Downstream features will stop working.`)) return;
    setSaving(true);
    try {
      await revokeKey({ id: existing._id });
      toast.success("Revoked.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b space-y-1.5">
          <p className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            {providerInfo.category} · integration
          </p>
          <DialogTitle className="text-xl font-semibold">
            {providerInfo.name}
          </DialogTitle>
          <DialogDescription>{providerInfo.description}</DialogDescription>
          {existing && (
            <p className="text-xs text-muted-foreground mt-2 font-mono">
              Current: ••••{existing.lastFour} · v{existing.keyVersion}
            </p>
          )}
        </DialogHeader>
        <div className="px-6 py-4 space-y-4">
          <div className="flex items-center gap-3 text-xs">
            <a
              href={providerInfo.signupUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              Get key <ExternalLink className="size-2.5" />
            </a>
            <a
              href={providerInfo.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              Docs <ExternalLink className="size-2.5" />
            </a>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
              {existing ? "New key value" : "Key value"}
            </Label>
            <Input
              autoFocus
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={providerInfo.keyFormatHint ?? "Paste key…"}
              className="font-mono"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Encrypted with AES-GCM before storage. Never leaves the server after this point.
          </p>
        </div>
        <DialogFooter className="border-t px-6 py-3 flex-row items-center gap-2 sm:justify-between">
          {existing ? (
            <Button
              onClick={revoke}
              disabled={saving}
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="size-3.5" /> Revoke
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button
              onClick={onClose}
              disabled={saving}
              variant="ghost"
              size="sm"
            >
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={saving || value.trim().length === 0}
              size="sm"
              className="gap-1.5"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : existing ? (
                <RotateCw className="size-3.5" />
              ) : (
                <KeyRound className="size-3.5" />
              )}
              {existing ? "Rotate" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

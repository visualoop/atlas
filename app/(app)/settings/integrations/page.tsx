"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { X, Check, Loader2, KeyRound, RotateCw, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id, Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Provider =
  | "gemini" | "groq" | "openrouter" | "mistral" | "cohere" | "cerebras"
  | "github_models" | "openai" | "anthropic" | "together"
  | "resend" | "meta_whatsapp" | "cloudflare_email_routing"
  | "google_maps_places" | "paystack" | "docuseal";

const PROVIDERS: Array<{
  id: Provider;
  name: string;
  category: string;
  note: string;
}> = [
  { id: "gemini", name: "Google Gemini", category: "AI", note: "Free 1M-context Flash" },
  { id: "groq", name: "Groq", category: "AI", note: "30 RPM, fast" },
  { id: "openrouter", name: "OpenRouter", category: "AI", note: "Many models, one key" },
  { id: "mistral", name: "Mistral", category: "AI", note: "Free with phone verify" },
  { id: "cohere", name: "Cohere", category: "AI", note: "Embeddings + rerank" },
  { id: "cerebras", name: "Cerebras", category: "AI", note: "Free, fast inference" },
  { id: "github_models", name: "GitHub Models", category: "AI", note: "Free with GitHub" },
  { id: "openai", name: "OpenAI", category: "AI", note: "Paid" },
  { id: "anthropic", name: "Anthropic", category: "AI", note: "Paid" },
  { id: "together", name: "Together AI", category: "AI", note: "Paid" },
  { id: "resend", name: "Resend", category: "Email", note: "Outbound + inbound" },
  { id: "cloudflare_email_routing", name: "Cloudflare Email Routing", category: "Email", note: "Inbound routing" },
  { id: "meta_whatsapp", name: "Meta WhatsApp", category: "WhatsApp", note: "Cloud API direct" },
  { id: "google_maps_places", name: "Google Maps Places", category: "Lead gen", note: "Prospector" },
  { id: "paystack", name: "Paystack", category: "Payments", note: "Card + M-PESA + bank" },
  { id: "docuseal", name: "DocuSeal", category: "Documents", note: "E-signature, self-hosted" },
];

export default function IntegrationsPage() {
  const keys = useQuery(api.integrations.list, {});
  const byCategory = useMemo(() => {
    return PROVIDERS.reduce<Record<string, typeof PROVIDERS>>((acc, p) => {
      (acc[p.category] ||= []).push(p);
      return acc;
    }, {});
  }, []);

  const [openProvider, setOpenProvider] = useState<Provider | null>(null);

  const keyByProvider = useMemo(() => {
    if (!keys) return new Map();
    const map = new Map<Provider, (typeof keys)[number]>();
    for (const k of keys) {
      if (k.label === "Primary" && k.status === "active") {
        map.set(k.provider as Provider, k);
      }
    }
    return map;
  }, [keys]);

  return (
    <>
      <div className="space-y-12">
        <p className="text-sm text-muted-foreground max-w-prose">
          Org-level keys. Encrypted at rest with AES-GCM. Only org
          admins can add or rotate; every access is audited. Keys are
          never returned to the browser — only the last four
          characters are shown for identification.
        </p>

        {Object.entries(byCategory).map(([category, items]) => (
          <section key={category} className="space-y-3">
            <p className="eyebrow">{category}</p>
            <div className="border border-border divide-y divide-border">
              {items.map((p) => {
                const key = keyByProvider.get(p.id);
                return (
                  <div key={p.id} className="flex items-center px-4 py-4 gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.note}</p>
                    </div>
                    {key ? (
                      <span className="inline-flex items-center gap-2 eyebrow text-[var(--success)]">
                        <Check className="size-3" />
                        Set · ••••{key.lastFour}
                      </span>
                    ) : (
                      <span className="eyebrow text-muted-foreground">Not set</span>
                    )}
                    <button
                      onClick={() => setOpenProvider(p.id)}
                      className="font-mono uppercase tracking-[0.12em] text-xs px-3 py-1.5 border border-[var(--border-strong)] hover:border-foreground hover:bg-muted transition-colors"
                    >
                      {key ? "Rotate" : "Add key"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {openProvider && (
        <ProviderKeyDialog
          provider={openProvider}
          providerLabel={PROVIDERS.find((p) => p.id === openProvider)?.name ?? openProvider}
          existing={keyByProvider.get(openProvider) ?? null}
          onClose={() => setOpenProvider(null)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function ProviderKeyDialog({
  provider, providerLabel, existing, onClose,
}: {
  provider: Provider;
  providerLabel: string;
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
    if (!window.confirm(`Revoke the ${providerLabel} key? Downstream features will stop working.`)) return;
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
    <div className="fixed inset-0 z-50 grid place-items-center pointer-events-none">
      <div
        onClick={() => !saving && onClose()}
        className="absolute inset-0 bg-background/70 backdrop-blur-sm pointer-events-auto"
      />
      <div
        role="dialog"
        aria-label={`${providerLabel} key`}
        className="relative pointer-events-auto bg-background border border-border w-full max-w-md shadow-2xl"
      >
        <header className="px-6 pt-5 pb-3 border-b border-border">
          <p className="eyebrow font-mono text-muted-foreground">Integration key</p>
          <h2 className="font-display italic text-2xl mt-1">{providerLabel}.</h2>
          {existing && (
            <p className="text-xs text-muted-foreground mt-2 font-mono">
              Current: ••••{existing.lastFour} · v{existing.keyVersion}
            </p>
          )}
        </header>
        <div className="px-6 py-4 space-y-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
              {existing ? "New key value" : "Key value"}
            </span>
            <input
              autoFocus
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Paste key…"
              className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none font-mono"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Encrypted with AES-GCM before storage. Never leaves the server after this point.
          </p>
        </div>
        <footer className="border-t border-border px-6 py-3 flex items-center gap-2">
          {existing && (
            <button
              onClick={revoke}
              disabled={saving}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-mono uppercase tracking-[0.12em] text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
            >
              <Trash2 className="size-3.5" /> Revoke
            </button>
          )}
          <button
            onClick={onClose}
            disabled={saving}
            className="ml-auto inline-flex items-center h-8 px-4 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving || value.trim().length === 0}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-5 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
            )}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : existing ? <RotateCw className="size-3.5" /> : <KeyRound className="size-3.5" />}
            {existing ? "Rotate" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}

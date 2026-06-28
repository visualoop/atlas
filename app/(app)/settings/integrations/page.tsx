import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { listOrgKeys } from "@/lib/secrets/org";
import { Check } from "lucide-react";

const PROVIDERS = [
  { id: "gemini", name: "Google Gemini", category: "AI", note: "Free 1M-context Flash" },
  { id: "groq", name: "Groq", category: "AI", note: "30 RPM, fast" },
  { id: "openrouter", name: "OpenRouter", category: "AI", note: "Many models, one key" },
  { id: "mistral", name: "Mistral", category: "AI", note: "Free with phone verify" },
  { id: "cohere", name: "Cohere", category: "AI", note: "Embeddings + rerank" },
  { id: "cerebras", name: "Cerebras", category: "AI", note: "Free, fast inference" },
  { id: "github_models", name: "GitHub Models", category: "AI", note: "Free with GitHub" },
  { id: "openai", name: "OpenAI", category: "AI", note: "Paid" },
  { id: "anthropic", name: "Anthropic", category: "AI", note: "Paid" },
  { id: "resend", name: "Resend", category: "Email", note: "Outbound + inbound" },
  { id: "meta_whatsapp", name: "Meta WhatsApp", category: "WhatsApp", note: "Cloud API direct" },
  { id: "google_maps_places", name: "Google Maps Places", category: "Lead gen", note: "Prospector" },
  { id: "paystack", name: "Paystack", category: "Payments", note: "All payments" },
  { id: "docuseal", name: "DocuSeal", category: "Documents", note: "E-signature, self-hosted" },
];

export default async function IntegrationsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.session.activeOrganizationId) {
    return (
      <div className="text-sm text-muted-foreground">
        You need an organization to manage integrations. Create or join one to continue.
      </div>
    );
  }

  const configured = await listOrgKeys(session.session.activeOrganizationId);
  const configuredByProvider = new Map(configured.map((k) => [k.provider, k]));

  const byCategory = PROVIDERS.reduce<Record<string, typeof PROVIDERS>>((acc, p) => {
    (acc[p.category] ||= []).push(p);
    return acc;
  }, {});

  return (
    <div className="space-y-12">
      <p className="text-sm text-muted-foreground max-w-prose">
        Org-level keys. Encrypted at rest. Only org owners can view; members use them via Atlas
        server (never in browser). See <code className="font-mono text-xs">plan/06-auth-and-permissions.md</code>.
      </p>

      {Object.entries(byCategory).map(([category, items]) => (
        <section key={category} className="space-y-3">
          <p className="eyebrow">{category}</p>
          <div className="border border-border divide-y divide-border">
            {items.map((p) => {
              const k = configuredByProvider.get(p.id);
              return (
                <div key={p.id} className="flex items-center px-4 py-4 gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.note}</p>
                  </div>
                  {k ? (
                    <span className="eyebrow flex items-center gap-1.5 text-primary">
                      <Check className="size-3" /> ••••{k.lastFour}
                    </span>
                  ) : (
                    <span className="eyebrow text-muted-foreground">Not set</span>
                  )}
                  <button className="font-mono uppercase tracking-[0.12em] text-xs px-3 py-1.5 border border-border-strong hover:border-primary hover:text-primary transition-colors">
                    {k ? "Rotate" : "Add key"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <p className="text-xs text-muted-foreground italic">
        Add-key flows wire in fully during Phase 5 (AI provider gateway) and the corresponding
        phase for each non-AI provider.
      </p>
    </div>
  );
}

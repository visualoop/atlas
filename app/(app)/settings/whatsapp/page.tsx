"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { Plus, MessageSquare, Copy, Check, Loader2, X, ExternalLink } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function WhatsAppSettingsPage() {
  const connections = useQuery(api.whatsapp.listConnections, {});
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      <div className="space-y-8">
        <div>
          <p className="text-sm text-muted-foreground max-w-prose">
            Connect one or more WhatsApp Business phone numbers directly to Meta Cloud API.
            Atlas is not a BSP — you own the connection. To set up:
          </p>
          <ol className="mt-3 list-decimal pl-5 text-sm text-muted-foreground space-y-1 max-w-prose">
            <li>Create a Meta Business App at <a href="https://business.facebook.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">business.facebook.com</a>.</li>
            <li>Add the WhatsApp product, get your WABA ID + Phone Number ID.</li>
            <li>Generate a System User access token with <code className="font-mono text-xs">whatsapp_business_messaging</code> + <code className="font-mono text-xs">whatsapp_business_management</code> scopes.</li>
            <li>Save the token in Settings → Integrations → Meta WhatsApp.</li>
            <li>Add the connection here, then paste the resulting webhook URL + verify token into Meta.</li>
          </ol>
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Connections</p>
            <button
              onClick={() => setAddOpen(true)}
              className="font-mono uppercase tracking-[0.12em] text-xs px-3 py-1.5 border border-[var(--border-strong)] hover:border-foreground hover:bg-muted transition-colors inline-flex items-center gap-1.5"
            >
              <Plus className="size-3.5" /> Add
            </button>
          </div>

          {connections === undefined ? (
            <div className="border border-border p-6 text-sm text-muted-foreground">Loading…</div>
          ) : connections.length === 0 ? (
            <div className="border border-dashed border-border p-8 text-center space-y-3">
              <MessageSquare className="size-8 text-muted-foreground mx-auto" />
              <p className="font-display italic text-xl text-muted-foreground">
                No WhatsApp numbers connected.
              </p>
              <button
                onClick={() => setAddOpen(true)}
                className="font-mono uppercase tracking-[0.12em] text-xs px-6 py-3 bg-primary text-primary-foreground active:scale-[0.97] transition-transform"
              >
                + Connect a number
              </button>
            </div>
          ) : (
            <div className="border border-border divide-y divide-border">
              {connections.map((c) => (
                <ConnectionRow key={c._id} connection={c} />
              ))}
            </div>
          )}
        </section>
      </div>

      {addOpen && <AddConnectionDialog onClose={() => setAddOpen(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */

function ConnectionRow({ connection: c }: { connection: Doc<"whatsappConnections"> }) {
  const [copied, setCopied] = useState<"url" | "token" | null>(null);
  const disconnect = useMutation(api.whatsapp.disconnect);
  const webhookUrl = `${process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site") ?? "https://3221.blyss.co.ke"}/webhook/whatsapp`;

  return (
    <div className="px-4 py-4 space-y-2">
      <div className="flex items-start gap-3">
        <MessageSquare className="size-4 text-muted-foreground mt-1" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{c.displayPhoneNumber}</p>
          <p className="text-xs text-muted-foreground">
            {c.verifiedName ?? "Not yet verified"} · WABA <span className="font-mono">{c.wabaId.slice(0, 10)}…</span>
          </p>
          <p className="text-xs mt-1">
            <StatusPill status={c.status} />
            {c.qualityRating && <span className="ml-2 text-muted-foreground">Quality: {c.qualityRating}</span>}
            {c.messagingLimitTier && <span className="ml-2 text-muted-foreground">{c.messagingLimitTier}</span>}
          </p>
        </div>
        <button
          onClick={async () => {
            if (!confirm("Disconnect this WhatsApp number? Meta webhooks will still arrive but will be dropped.")) return;
            await disconnect({ id: c._id });
            toast.success("Disconnected.");
          }}
          className="text-xs text-muted-foreground hover:text-[var(--danger)] transition-colors"
        >
          Disconnect
        </button>
      </div>

      <div className="pt-3 border-t border-border grid grid-cols-1 gap-2 text-xs">
        <div>
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <span className="eyebrow">Webhook URL</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="font-mono text-xs bg-muted px-2 py-1 flex-1 truncate">{webhookUrl}</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(webhookUrl);
                setCopied("url");
                setTimeout(() => setCopied(null), 1500);
              }}
              className="size-7 grid place-items-center hover:bg-muted transition-colors"
              title="Copy"
            >
              {copied === "url" ? <Check className="size-3.5 text-[var(--success)]" /> : <Copy className="size-3.5" />}
            </button>
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <span className="eyebrow">Verify token</span>
          </div>
          <div className="flex items-center gap-2">
            <code className="font-mono text-xs bg-muted px-2 py-1 flex-1 truncate">{c.webhookVerifyToken}</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(c.webhookVerifyToken);
                setCopied("token");
                setTimeout(() => setCopied(null), 1500);
              }}
              className="size-7 grid place-items-center hover:bg-muted transition-colors"
              title="Copy"
            >
              {copied === "token" ? <Check className="size-3.5 text-[var(--success)]" /> : <Copy className="size-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    connected: "text-[var(--success)] border-[var(--success)]",
    pending: "text-[var(--warning)] border-[var(--warning)]",
    disconnected: "text-muted-foreground border-border",
    banned: "text-[var(--danger)] border-[var(--danger)]",
  };
  return (
    <span className={cn("inline-flex items-center font-mono uppercase tracking-[0.12em] text-[10px] border px-2 py-0.5", map[status] ?? map.disconnected)}>
      {status}
    </span>
  );
}

/* ------------------------------------------------------------------ */

function AddConnectionDialog({ onClose }: { onClose: () => void }) {
  const [wabaId, setWabaId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState("");
  const [verifiedName, setVerifiedName] = useState("");
  const [webhookVerifyToken, setWebhookVerifyToken] = useState(() => randomToken());
  const [saving, setSaving] = useState(false);
  const connect = useMutation(api.whatsapp.connect);

  async function submit() {
    if (!wabaId.trim() || !phoneNumberId.trim() || !displayPhoneNumber.trim()) {
      toast.error("WABA ID, Phone Number ID, and display number are required.");
      return;
    }
    setSaving(true);
    try {
      await connect({
        wabaId: wabaId.trim(),
        phoneNumberId: phoneNumberId.trim(),
        displayPhoneNumber: displayPhoneNumber.trim(),
        verifiedName: verifiedName.trim() || undefined,
        webhookVerifyToken: webhookVerifyToken.trim(),
      });
      toast.success("Connection saved. Paste the webhook URL into Meta to activate.");
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
      <div className="relative pointer-events-auto bg-background border border-border w-full max-w-lg shadow-2xl">
        <header className="px-6 pt-5 pb-3 border-b border-border">
          <p className="eyebrow font-mono text-muted-foreground">New WhatsApp connection</p>
          <h2 className="font-display italic text-2xl mt-1">Which <em>number</em>?</h2>
        </header>
        <div className="px-6 py-4 space-y-3">
          <Field label="WABA ID" value={wabaId} onChange={setWabaId} placeholder="123456789012345" />
          <Field label="Phone Number ID" value={phoneNumberId} onChange={setPhoneNumberId} placeholder="123456789012345" />
          <Field label="Display number" value={displayPhoneNumber} onChange={setDisplayPhoneNumber} placeholder="+254 700 000 000" />
          <Field label="Verified name" value={verifiedName} onChange={setVerifiedName} placeholder="Blyss" optional />
          <Field label="Webhook verify token" value={webhookVerifyToken} onChange={setWebhookVerifyToken} />
          <p className="text-xs text-muted-foreground">
            After saving, paste the webhook URL + this verify token into Meta's WhatsApp webhook config. Once Meta confirms, status flips to <em>connected</em>.
          </p>
        </div>
        <footer className="border-t border-border px-6 py-3 flex items-center gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={saving}
            className="inline-flex items-center h-8 px-4 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-5 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  optional?: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
        {label} {optional && <span className="normal-case tracking-normal text-muted-foreground/60">— optional</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none font-mono"
      />
    </label>
  );
}

function randomToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

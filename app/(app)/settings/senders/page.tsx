"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { Mail, MessageSquare, Plus, Star, Loader2, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function SenderIdentitiesPage() {
  const identities = useQuery(api.emails.listSenderIdentities, {});
  const [addOpen, setAddOpen] = useState(false);

  const email = identities?.filter((s) => s.channel === "email") ?? [];

  return (
    <>
      <div className="space-y-8">
        <div>
          <p className="text-sm text-muted-foreground max-w-prose">
            Each workspace can send from one or more verified addresses. Inbound email
            is routed to the workspace whose sender identity matches the recipient.
            Configure DNS at your domain host (SPF + DKIM via Resend) — Atlas will
            check verification status the next time you rotate the Resend key.
          </p>
        </div>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Email</p>
            <button
              onClick={() => setAddOpen(true)}
              className="font-mono uppercase tracking-[0.12em] text-xs px-3 py-1.5 border border-[var(--border-strong)] hover:border-foreground hover:bg-muted transition-colors inline-flex items-center gap-1.5"
            >
              <Plus className="size-3.5" /> Add
            </button>
          </div>

          {identities === undefined ? (
            <div className="border border-border p-6 text-sm text-muted-foreground">Loading…</div>
          ) : email.length === 0 ? (
            <div className="border border-dashed border-border p-8 text-center space-y-3">
              <p className="font-display italic text-xl text-muted-foreground">
                No sender identities yet.
              </p>
              <p className="text-sm text-muted-foreground max-w-prose mx-auto">
                Add one to start sending email from Atlas. Example: <code className="font-mono text-xs">justine@blyss.co.ke</code>
              </p>
              <button
                onClick={() => setAddOpen(true)}
                className="font-mono uppercase tracking-[0.12em] text-xs px-6 py-3 bg-primary text-primary-foreground active:scale-[0.97] transition-transform"
              >
                + Add identity
              </button>
            </div>
          ) : (
            <div className="border border-border divide-y divide-border">
              {email.map((s) => (
                <IdentityRow key={s._id} identity={s} />
              ))}
            </div>
          )}
        </section>
      </div>

      {addOpen && <AddIdentityDialog onClose={() => setAddOpen(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */

function IdentityRow({ identity }: { identity: Doc<"senderIdentities"> }) {
  return (
    <div className="flex items-center px-4 py-4 gap-4">
      <Mail className="size-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">
          {identity.displayName ? (
            <>
              <span>{identity.displayName}</span>{" "}
              <span className="text-muted-foreground">&lt;{identity.address}&gt;</span>
            </>
          ) : (
            identity.address
          )}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
          {identity.isDefault && (
            <span className="inline-flex items-center gap-1 text-primary">
              <Star className="size-3 fill-current" /> Default
            </span>
          )}
          {identity.dkimVerified ? (
            <span className="text-[var(--success)]">DKIM ✓</span>
          ) : (
            <span className="text-muted-foreground">DKIM unverified</span>
          )}
          {identity.spfVerified && <span className="text-[var(--success)]">SPF ✓</span>}
        </p>
      </div>
    </div>
  );
}

function AddIdentityDialog({ onClose }: { onClose: () => void }) {
  const [address, setAddress] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [saving, setSaving] = useState(false);
  const addSenderIdentity = useMutation(api.emails.addSenderIdentity);

  async function submit() {
    const clean = address.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      toast.error("Enter a valid email address.");
      return;
    }
    setSaving(true);
    try {
      await addSenderIdentity({
        channel: "email",
        address: clean,
        displayName: displayName.trim() || undefined,
        isDefault,
      });
      toast.success("Identity added.");
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
      <div className="relative pointer-events-auto bg-background border border-border w-full max-w-md shadow-2xl">
        <header className="px-6 pt-5 pb-3 border-b border-border">
          <p className="eyebrow font-mono text-muted-foreground">New sender identity</p>
          <h2 className="font-display italic text-2xl mt-1">Where do you send <em>from</em>?</h2>
        </header>
        <div className="px-6 py-4 space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
              Email address
            </span>
            <input
              autoFocus
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="justine@blyss.co.ke"
              className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
              Display name <span className="normal-case tracking-normal text-muted-foreground/60">— optional</span>
            </span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Justine Gichana"
              className="w-full h-9 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </label>
          <label className="flex items-center gap-2 text-sm mt-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="size-3.5"
            />
            Set as default for this workspace
          </label>
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
            disabled={saving || !address.trim()}
            className={cn(
              "inline-flex items-center gap-1.5 h-8 px-5 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.97] transition-transform",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Add
          </button>
        </footer>
      </div>
    </div>
  );
}

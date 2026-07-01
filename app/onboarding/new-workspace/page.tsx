"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

const CURRENCIES = ["KES", "USD", "EUR", "GBP", "TZS", "UGX", "RWF"];
const TIMEZONES = [
  "Africa/Nairobi",
  "Africa/Kampala",
  "Africa/Dar_es_Salaam",
  "Africa/Kigali",
  "Africa/Lagos",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
];

export default function NewWorkspacePage() {
  const router = useRouter();
  const bootstrap = useQuery(api.organizations.currentBootstrap);
  const create = useMutation(api.organizations.createWorkspace);
  const setActive = useMutation(api.organizations.setActiveWorkspace);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState("KES");
  const [timezone, setTimezone] = useState("Africa/Nairobi");
  const [orgId, setOrgId] = useState<Id<"organizations"> | "">("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (bootstrap?.activeOrg && !orgId) {
      setOrgId(bootstrap.activeOrg._id as Id<"organizations">);
    }
  }, [bootstrap, orgId]);

  function syncSlug(v: string) {
    setName(v);
    setSlug(
      v
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40),
    );
  }

  async function submit() {
    if (!name.trim() || !slug || !orgId) {
      toast.error("Fill in name + slug.");
      return;
    }
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
      toast.error("Slug must be 2-40 lowercase letters, digits, or hyphens.");
      return;
    }
    setSaving(true);
    try {
      const newId = await create({
        organizationId: orgId,
        slug,
        name: name.trim(),
        description: description.trim() || undefined,
        currency,
        timezone,
      });
      await setActive({ workspaceId: newId });
      toast.success("Workspace created.");
      router.push("/today");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setSaving(false);
    }
  }

  if (!bootstrap) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!bootstrap.activeOrg) {
    return (
      <div className="min-h-screen grid place-items-center px-6">
        <div className="max-w-md space-y-4 text-center">
          <p className="eyebrow">No organisation</p>
          <p className="text-sm text-muted-foreground">
            Create an organisation first — workspaces belong to orgs.
          </p>
          <Link
            href="/onboarding/new-org"
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-primary text-primary-foreground text-xs font-mono uppercase tracking-[0.12em]"
          >
            Create organisation
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-lg space-y-8">
        <Link
          href="/today"
          className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" />
          Back to Today
        </Link>

        <header className="space-y-2">
          <p className="eyebrow">
            <Sparkles className="size-3 inline mr-1 text-primary" />
            Onboarding · {bootstrap.activeOrg.name}
          </p>
          <h1 className="font-display italic text-5xl tracking-tight">
            New workspace<span className="text-primary">.</span>
          </h1>
          <p className="text-sm text-muted-foreground max-w-prose">
            One workspace is one product, business unit, or client. Isolated
            contacts, deals, inbox, and campaigns. You can switch between
            workspaces from the top-left dropdown.
          </p>
        </header>

        <section className="border border-border p-6 space-y-4">
          <Field label="Workspace name" required hint="Change any time.">
            <input
              value={name}
              onChange={(e) => syncSlug(e.target.value)}
              placeholder="Omnix"
              autoFocus
              className="w-full h-10 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
            />
          </Field>

          <Field label="Slug" required hint="URL-safe, must be unique in this org.">
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="omnix"
              className="w-full h-10 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none font-mono"
              maxLength={40}
            />
          </Field>

          <Field label="Short description" hint="One-line context for the AI.">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="POS + inventory for Kenyan retail"
              className="w-full h-10 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Currency" required>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full h-10 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>

            <Field label="Timezone" required>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full h-10 px-3 text-sm bg-transparent border border-border focus:border-foreground focus:outline-none"
              >
                {TIMEZONES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        <div className="flex items-center gap-2">
          <Link
            href="/today"
            className="text-xs font-mono uppercase tracking-[0.12em] h-10 px-4 grid place-items-center text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Link>
          <button
            onClick={submit}
            disabled={saving || !name.trim() || !slug}
            className="ml-auto inline-flex items-center gap-1.5 h-10 px-6 bg-primary text-primary-foreground text-xs font-mono uppercase tracking-[0.12em] active:scale-[0.97] disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Create workspace
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label, hint, required, children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className="eyebrow">{label}{required && " *"}</span>
        {hint && <span className="text-[11px] text-muted-foreground italic">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

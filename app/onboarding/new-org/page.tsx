"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function NewOrgPage() {
  const router = useRouter();
  const create = useMutation(api.organizations.createOrganization);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [firstWorkspace, setFirstWorkspace] = useState("Main");
  const [saving, setSaving] = useState(false);

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
    if (!name.trim() || !slug || !firstWorkspace.trim()) {
      toast.error("Fill in every field.");
      return;
    }
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
      toast.error("Slug must be 2-40 lowercase letters, digits, or hyphens.");
      return;
    }
    setSaving(true);
    try {
      await create({
        name: name.trim(),
        slug,
        firstWorkspaceName: firstWorkspace.trim(),
      });
      toast.success("Organisation created.");
      router.push("/today");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed.");
    } finally {
      setSaving(false);
    }
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
            Onboarding
          </p>
          <h1 className="font-display italic text-5xl tracking-tight">
            New organisation<span className="text-primary">.</span>
          </h1>
          <p className="text-sm text-muted-foreground max-w-prose">
            One org owns many workspaces. Use orgs to keep separate businesses,
            teams, or agency clients isolated. You'll be the owner.
          </p>
        </header>

        <section className="border border-border p-6 space-y-4">
          <Field label="Organisation name" required hint="What people will call this. Change any time.">
            <Input
              value={name}
              onChange={(e) => syncSlug(e.target.value)}
              placeholder="Blyss"
              autoFocus
            />
          </Field>

          <Field label="Slug" required hint="URL-safe. Lowercase + dashes only.">
            <Input
              value={slug}
              onChange={(e) =>
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
              }
              placeholder="blyss"
              className="font-mono"
              maxLength={40}
            />
          </Field>

          <Field label="First workspace name" required hint="You can add more later. Common patterns: product name, business unit, or client name.">
            <Input
              value={firstWorkspace}
              onChange={(e) => setFirstWorkspace(e.target.value)}
              placeholder="Omnix"
            />
          </Field>
        </section>

        <div className="flex items-center gap-2">
          <Link
            href="/today"
            className="text-xs font-mono uppercase tracking-[0.12em] h-10 px-4 grid place-items-center text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Link>
          <Button
            onClick={submit}
            disabled={saving || !name.trim() || !slug || !firstWorkspace.trim()}
            size="lg"
            className="ml-auto h-10 px-6 text-xs font-mono uppercase tracking-[0.12em]"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Create organisation
          </Button>
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

"use client";

import { useState, useEffect, use } from "react";
import { useQuery, useMutation } from "convex/react";
import { Loader2, Check, ArrowRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function PublicLandingPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; pageSlug: string }>;
}) {
  const resolved = use(params);
  const data = useQuery(api.content.getLandingPageBySlug, {
    workspaceSlug: resolved.workspaceSlug,
    pageSlug: resolved.pageSlug,
  });
  const recordView = useMutation(api.content.recordLandingView);
  const submit = useMutation(api.content.submitLandingSignup);

  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Fire view exactly once when the page loads
  useEffect(() => {
    if (data) {
      recordView({
        workspaceSlug: resolved.workspaceSlug,
        pageSlug: resolved.pageSlug,
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data === null || data === undefined ? undefined : data.page._id]);

  if (data === undefined) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="min-h-screen grid place-items-center text-center p-8">
        <div className="space-y-2">
          <p className="font-display italic text-3xl text-muted-foreground">Not found.</p>
          <p className="text-sm text-muted-foreground">
            This page has moved, been unpublished, or never existed.
          </p>
        </div>
      </div>
    );
  }

  const { page, workspaceName } = data;
  const fields = new Set(page.formFields ?? ["email", "firstName"]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Enter your email.");
      return;
    }
    setSubmitting(true);
    try {
      await submit({
        workspaceSlug: resolved.workspaceSlug,
        pageSlug: resolved.pageSlug,
        email: email.trim(),
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        company: company.trim() || undefined,
      });
      setDone(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 md:px-12 py-16 md:py-24">
        {/* Header */}
        <header className="space-y-3 mb-10">
          <p className="eyebrow font-mono text-muted-foreground">
            {page.kind.replace(/_/g, " ")} · {workspaceName}
          </p>
          <h1 className="font-display italic text-5xl md:text-6xl tracking-tight leading-[1.05]">
            {page.title}
          </h1>
          {page.subtitle && (
            <p className="text-xl text-muted-foreground max-w-2xl leading-relaxed">
              {page.subtitle}
            </p>
          )}
        </header>

        {/* Body */}
        {page.bodyText && (
          <article
            className="prose prose-neutral dark:prose-invert prose-lg max-w-none mb-10"
            dangerouslySetInnerHTML={{ __html: renderBodyHtml(page.body) }}
          />
        )}

        {/* Form */}
        <section className="mt-12 border-t border-border pt-10">
          {done ? (
            <div className="border border-[var(--success)] bg-[var(--success)]/5 p-6 flex items-start gap-3">
              <Check className="size-5 text-[var(--success)] shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-[var(--success)]">You're in.</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {page.kind === "lead_magnet"
                    ? "Check your inbox — we'll send the resource shortly."
                    : page.kind === "waitlist"
                      ? "We'll be in touch when there's news."
                      : "Thanks for signing up."}
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
              {fields.has("firstName") && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
                    First name
                  </span>
                  <input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full h-11 px-3 text-base bg-transparent border border-border focus:border-foreground focus:outline-none"
                  />
                </label>
              )}
              {fields.has("lastName") && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
                    Last name
                  </span>
                  <input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full h-11 px-3 text-base bg-transparent border border-border focus:border-foreground focus:outline-none"
                  />
                </label>
              )}
              {fields.has("company") && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
                    Company
                  </span>
                  <input
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="w-full h-11 px-3 text-base bg-transparent border border-border focus:border-foreground focus:outline-none"
                  />
                </label>
              )}
              <label className="block space-y-1.5">
                <span className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
                  Email
                </span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 px-3 text-base bg-transparent border border-border focus:border-foreground focus:outline-none"
                />
              </label>

              <button
                type="submit"
                disabled={submitting}
                className={cn(
                  "inline-flex items-center gap-2 h-11 px-6 text-xs font-mono uppercase tracking-[0.12em] bg-primary text-primary-foreground active:scale-[0.98] transition-transform",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowRight className="size-3.5" />}
                {page.kind === "waitlist" ? "Join waitlist"
                  : page.kind === "lead_magnet" ? "Get the resource"
                    : page.kind === "event" ? "Reserve my spot"
                      : "Continue"}
              </button>

              <p className="text-xs text-muted-foreground">
                By submitting, you consent to be contacted about this and related topics.
              </p>
            </form>
          )}
        </section>

        {/* Small footer */}
        <footer className="mt-16 pt-6 border-t border-border text-xs text-muted-foreground">
          <p>Published by {workspaceName} · Powered by Atlas</p>
        </footer>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */

function renderBodyHtml(body: unknown): string {
  if (body && typeof body === "object") {
    const b = body as { type?: string; html?: string; content?: unknown };
    if (b.type === "doc" && typeof b.html === "string") return b.html;
  }
  return tiptapToHtml(body);
}

function tiptapToHtml(body: unknown): string {
  const chunks: string[] = [];
  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; text?: string; content?: unknown[]; attrs?: { level?: number } };
    if (n.type === "paragraph") {
      chunks.push("<p>");
      n.content?.forEach(walk);
      chunks.push("</p>");
      return;
    }
    if (n.type === "heading") {
      const lvl = n.attrs?.level ?? 2;
      chunks.push(`<h${lvl}>`);
      n.content?.forEach(walk);
      chunks.push(`</h${lvl}>`);
      return;
    }
    if (n.type === "bulletList") {
      chunks.push("<ul>");
      n.content?.forEach(walk);
      chunks.push("</ul>");
      return;
    }
    if (n.type === "orderedList") {
      chunks.push("<ol>");
      n.content?.forEach(walk);
      chunks.push("</ol>");
      return;
    }
    if (n.type === "listItem") {
      chunks.push("<li>");
      n.content?.forEach(walk);
      chunks.push("</li>");
      return;
    }
    if (n.text) {
      chunks.push(escapeHtml(n.text));
      return;
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  }
  walk(body);
  return chunks.join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

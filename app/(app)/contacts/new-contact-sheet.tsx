"use client";

import { useState, useTransition } from "react";
import { useMutation } from "convex/react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";

const STAGES = ["cold", "warm", "qualified", "customer", "lost"] as const;

export function NewContactSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useMutation(api.contacts.create);
  const [pending, start] = useTransition();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("");
  const [stage, setStage] = useState<(typeof STAGES)[number]>("cold");

  function reset() {
    setFirstName(""); setLastName(""); setEmail(""); setPhone(""); setTitle("");
    setStage("cold");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        await create({
          firstName,
          lastName: lastName || undefined,
          email: email || undefined,
          phone: phone || undefined,
          title: title || undefined,
          lifecycleStage: stage,
        });
        toast.success(`${firstName} added.`);
        reset();
        onOpenChange(false);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not create contact";
        toast.error(msg);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[480px] p-0 border-l border-[var(--border-strong)] rounded-none"
      >
        <SheetTitle className="sr-only">New contact</SheetTitle>
        <div className="h-full flex flex-col">
          <header className="border-b border-border px-6 py-5">
            <p className="eyebrow">New</p>
            <h2 className="text-2xl font-display italic mt-1">Contact</h2>
          </header>

          <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <Field label="First name">
                <Input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  autoFocus
                />
              </Field>
              <Field label="Last name">
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </Field>
            </div>
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="patricia@example.com"
              />
            </Field>
            <Field label="Phone">
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+254 712 345 678"
              />
            </Field>
            <Field label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Founder, Mchoro Mawe"
              />
            </Field>
            <Field label="Stage">
              <div className="flex gap-1 flex-wrap">
                {STAGES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStage(s)}
                    className={`font-mono uppercase tracking-[0.12em] text-xs px-3 py-1.5 border transition-colors ${
                      stage === s
                        ? "border-primary text-primary"
                        : "border-border text-muted-foreground hover:border-border-strong"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Field>
          </form>

          <footer className="border-t border-border px-6 py-4 flex justify-end gap-3">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending || !firstName}>
              {pending ? "…" : "Create"}
            </Button>
          </footer>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="eyebrow">{label}</Label>
      {children}
    </div>
  );
}

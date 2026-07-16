"use client";

import { useState, useTransition } from "react";
import { useMutation } from "convex/react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";

const STAGES = ["cold", "warm", "qualified", "customer", "lost"] as const;

export function NewCompanySheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useMutation(api.companies.create);
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [industry, setIndustry] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("KE");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [stage, setStage] = useState<(typeof STAGES)[number]>("cold");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      try {
        await create({
          name,
          domain: domain || undefined,
          industry: industry || undefined,
          city: city || undefined,
          country: country || "KE",
          phone: phone || undefined,
          emailPrimary: email || undefined,
          description: description || undefined,
          lifecycleStage: stage,
        });
        toast.success(`${name} added.`);
        setName(""); setDomain(""); setIndustry(""); setCity(""); setCountry("KE");
        setPhone(""); setEmail(""); setDescription(""); setStage("cold");
        onOpenChange(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not create company");
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[480px] p-0 border-l border-[var(--border-strong)] rounded-none"
      >
        <SheetTitle className="sr-only">New company</SheetTitle>
        <div className="h-full flex flex-col">
          <header className="border-b border-border px-6 py-5">
            <p className="eyebrow">New</p>
            <h2 className="text-2xl font-display italic mt-1">Company</h2>
          </header>

          <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Domain">
                <Input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="mchoromawe.co.ke"
                />
              </Field>
              <Field label="Industry">
                <Input
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="Construction"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="City">
                <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Nairobi" />
              </Field>
              <Field label="Country">
                <Input
                  value={country}
                  onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
                  maxLength={2}
                />
              </Field>
            </div>
            <Field label="Phone">
              <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+254 …" />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="info@example.com"
              />
            </Field>
            <Field label="Description">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="min-h-0"
              />
            </Field>
            <Field label="Stage">
              <div className="flex gap-1 flex-wrap">
                {STAGES.map((s) => (
                  <Button
                    key={s}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setStage(s)}
                    className={cn(
                      "font-mono uppercase tracking-[0.12em] text-xs",
                      stage === s
                        ? "border-primary text-primary"
                        : "text-muted-foreground",
                    )}
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </Field>
          </form>

          <footer className="border-t border-border px-6 py-4 flex justify-end gap-3">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending || !name}>
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

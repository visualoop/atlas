import { LoginForm } from "./login-form";
import { Sparkles } from "lucide-react";

export const metadata = { title: "Sign in — Atlas" };

export default function LoginPage() {
  return (
    <main className="min-h-screen grid lg:grid-cols-2">
      {/* Left — brand panel (hidden on mobile) */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-primary p-12 text-primary-foreground">
        {/* Soft decorative glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 -right-40 size-96 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-24 size-80 rounded-full bg-black/10 blur-3xl"
        />

        <div className="relative flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-lg bg-white/15 backdrop-blur">
            <Sparkles className="size-4" />
          </div>
          <span className="text-sm font-semibold tracking-tight">Atlas</span>
        </div>

        <div className="relative space-y-6">
          <h2 className="font-display text-4xl xl:text-5xl leading-[1.1] tracking-tight">
            The operating system
            <br />
            for a founder.
          </h2>
          <p className="text-base/relaxed text-primary-foreground/80 max-w-[42ch]">
            Prospecting, outreach, pipelines, and a chief-of-staff AI that
            drafts, ranks, and nudges — so your job is reviewing and
            deciding.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            {["Prospector", "Inbox AI", "Pipelines", "Campaigns"].map((t) => (
              <span
                key={t}
                className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium backdrop-blur"
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-primary-foreground/60">
          Built by Blyss · Nairobi
        </p>
      </aside>

      {/* Right — form */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          {/* Mobile brand mark */}
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="size-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight">Atlas</span>
          </div>

          <div className="mb-8 space-y-2">
            <h1 className="font-display text-3xl sm:text-4xl leading-tight tracking-tight">
              Welcome back.
            </h1>
            <p className="text-sm text-muted-foreground">
              Sign in to your workspace to keep building.
            </p>
          </div>

          <LoginForm />
        </div>
      </div>
    </main>
  );
}

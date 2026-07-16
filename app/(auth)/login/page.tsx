import { LoginForm } from "./login-form";
import { AtlasMark } from "@/components/atlas/atlas-mark";

export const metadata = { title: "Sign in — Atlas" };

export default function LoginPage() {
  return (
    <main className="min-h-screen grid lg:grid-cols-[1.05fr_1fr]">
      {/* Left — brand panel (hidden on mobile) */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden p-14 text-[oklch(0.93_0.02_85)]">
        {/* Deep ink base with a warm gilded undertone */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 78% 8%, oklch(0.21 0.035 45) 0%, oklch(0.15 0.02 42) 42%, oklch(0.11 0.006 60) 100%)",
          }}
        />
        {/* Topographic contour rings — cartographic texture, not a blur blob */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.14] mix-blend-screen"
          style={{
            backgroundImage:
              "repeating-radial-gradient(circle at 82% 14%, transparent 0 43px, oklch(0.78 0.13 82 / 0.55) 43px 44px)",
          }}
        />
        {/* Fine meridian grid */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(oklch(0.93 0.02 85 / 0.6) 1px, transparent 1px), linear-gradient(90deg, oklch(0.93 0.02 85 / 0.6) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />
        {/* Hairline frame */}
        <div
          aria-hidden
          className="absolute inset-6 rounded-[2px] border border-[oklch(0.78_0.13_82_/_0.18)]"
        />

        {/* Wordmark */}
        <div className="relative flex items-center gap-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-700 [animation-fill-mode:backwards]">
          <AtlasMark className="size-9 text-[oklch(0.82_0.13_82)]" />
          <span className="font-display text-2xl leading-none tracking-tight">
            Atlas
          </span>
        </div>

        {/* Headline block */}
        <div className="relative max-w-[24ch] space-y-7">
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[oklch(0.82_0.13_82)] animate-in fade-in-0 slide-in-from-bottom-3 duration-700 [animation-delay:120ms] [animation-fill-mode:backwards]">
            Est. Nairobi
          </p>
          <h2 className="font-display text-[3.4rem] xl:text-6xl leading-[1.02] tracking-tight animate-in fade-in-0 slide-in-from-bottom-3 duration-700 [animation-delay:220ms] [animation-fill-mode:backwards]">
            The operating system for a&nbsp;founder.
          </h2>
          <p className="text-[15px]/relaxed text-[oklch(0.93_0.02_85_/_0.66)] max-w-[40ch] animate-in fade-in-0 slide-in-from-bottom-3 duration-700 [animation-delay:360ms] [animation-fill-mode:backwards]">
            Prospecting, outreach, pipelines, and a chief-of-staff AI that
            drafts, ranks, and nudges — so your job is reviewing and deciding.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[oklch(0.93_0.02_85_/_0.55)] animate-in fade-in-0 slide-in-from-bottom-3 duration-700 [animation-delay:500ms] [animation-fill-mode:backwards]">
            {["Prospector", "Inbox AI", "Pipelines", "Campaigns"].map((t) => (
              <span key={t} className="inline-flex items-center gap-2">
                <span className="size-1 rounded-full bg-[oklch(0.82_0.13_82)]" />
                {t}
              </span>
            ))}
          </div>
        </div>

        <p className="relative font-mono text-[11px] uppercase tracking-[0.2em] text-[oklch(0.93_0.02_85_/_0.4)] animate-in fade-in-0 duration-700 [animation-delay:640ms] [animation-fill-mode:backwards]">
          Built by Blyss
        </p>
      </aside>

      {/* Right — form */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          {/* Mobile brand mark — gold on a hairline ring, no filled box */}
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <span className="grid size-10 place-items-center rounded-full border border-[oklch(0.78_0.13_82_/_0.4)]">
              <AtlasMark className="size-6 text-[oklch(0.7_0.15_82)]" />
            </span>
            <span className="font-display text-xl leading-none tracking-tight">
              Atlas
            </span>
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

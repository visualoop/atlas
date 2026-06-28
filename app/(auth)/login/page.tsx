import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/server";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Atlas" };

export default async function LoginPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/today");

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-12 space-y-2">
          <p className="eyebrow">Atlas</p>
          <h1 className="text-4xl md:text-5xl leading-[1.05] tracking-tight">
            Sign <em className="italic">in</em>.
          </h1>
          <p className="text-sm text-muted-foreground mt-3 max-w-[28ch]">
            The operating system for a founder. Built by Blyss.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}

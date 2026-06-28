import { redirect } from "next/navigation";
import { isAuthenticatedNextjs } from "@convex-dev/auth/nextjs/server";
import { AppShell } from "@/components/atlas/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAuthenticatedNextjs())) {
    redirect("/login");
  }
  return <AppShell>{children}</AppShell>;
}

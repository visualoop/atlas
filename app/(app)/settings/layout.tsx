"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/workspace", label: "Workspace" },
  { href: "/settings/security", label: "Security" },
  { href: "/settings/integrations", label: "Integrations" },
  { href: "/settings/senders", label: "Senders" },
  { href: "/settings/whatsapp", label: "WhatsApp" },
  { href: "/settings/referrals", label: "Referrals" },
  { href: "/settings/members", label: "Members" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="max-w-5xl mx-auto px-8 py-16">
      <p className="eyebrow">Settings</p>
      <h1 className="text-4xl md:text-5xl tracking-tight mt-2">
        Atlas <em className="italic font-display">configuration</em>.
      </h1>
      <nav className="mt-8 border-b border-border flex gap-1 overflow-x-auto">
        {ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "px-4 py-3 text-sm transition-colors border-b-2 -mb-px whitespace-nowrap",
                active
                  ? "text-foreground border-primary"
                  : "text-muted-foreground border-transparent hover:text-foreground hover:border-primary/40",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-8">{children}</div>
    </div>
  );
}

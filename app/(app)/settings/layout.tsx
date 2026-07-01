import Link from "next/link";

const ITEMS = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/security", label: "Security" },
  { href: "/settings/integrations", label: "Integrations" },
  { href: "/settings/senders", label: "Senders" },
  { href: "/settings/whatsapp", label: "WhatsApp" },
  { href: "/settings/members", label: "Members" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-5xl mx-auto px-8 py-16">
      <p className="eyebrow">Settings</p>
      <h1 className="text-4xl md:text-5xl tracking-tight mt-2">
        Atlas <em className="italic font-display">configuration</em>.
      </h1>
      <nav className="mt-8 border-b border-border flex gap-1">
        {ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="px-4 py-3 text-sm hover:text-foreground text-muted-foreground transition-colors border-b-2 border-transparent hover:border-primary -mb-px"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="mt-8">{children}</div>
    </div>
  );
}

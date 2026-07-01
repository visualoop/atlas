"use client";

import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * WhatsApp Web open-chat button.
 *
 * No Meta Cloud API required — uses the public wa.me deep link that
 * opens WhatsApp Web (desktop) or the WhatsApp app (mobile) with the
 * conversation preloaded and, optionally, a message pre-filled.
 *
 * Free forever, no verification, no phone number ID.
 *
 * Docs: https://faq.whatsapp.com/5913398998672934
 */
export function WhatsAppOpenChat({
  phone,
  text,
  label = "WhatsApp",
  className,
  size = "sm",
}: {
  phone: string | undefined;
  text?: string;
  label?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  if (!phone) return null;

  // Normalize to E.164 without the +
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 8) return null;

  const url = `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1.5 font-mono uppercase tracking-[0.12em] transition-colors",
        size === "sm"
          ? "text-xs h-8 px-3"
          : "text-sm h-9 px-4",
        "border border-[var(--border-strong)] hover:border-[#25D366] hover:text-[#25D366]",
        className,
      )}
      title="Opens the number in WhatsApp Web / your phone"
    >
      <MessageSquare className="size-3.5" />
      {label}
    </a>
  );
}

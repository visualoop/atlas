import { Button, Section, Text } from "@react-email/components";
import * as React from "react";
import { AtlasEmailShell } from "./atlas-email-shell";

interface Props {
  workspaceName: string;
  pageTitle: string;
  pageKind: "product_launch" | "waitlist" | "event" | "lead_magnet" | "custom";
  firstName?: string;
  leadMagnetUrl?: string;
  leadMagnetLabel?: string;
}

export function AtlasLandingWelcomeEmail({
  workspaceName,
  pageTitle,
  pageKind,
  firstName,
  leadMagnetUrl,
  leadMagnetLabel,
}: Props) {
  const heading =
    pageKind === "waitlist"
      ? "You're on the list."
      : pageKind === "lead_magnet"
        ? "Here's what you asked for."
        : pageKind === "event"
          ? "Your spot is reserved."
          : "Thanks for signing up.";
  const preview =
    pageKind === "lead_magnet"
      ? `Your download from ${workspaceName}`
      : pageKind === "waitlist"
        ? `You're on the ${pageTitle} waitlist`
        : `Confirmation · ${pageTitle}`;
  const salutation = firstName ? `${firstName},` : "Hi,";

  return (
    <AtlasEmailShell preview={preview}>
      <Text
        style={{
          fontFamily: "Georgia,serif",
          fontStyle: "italic",
          fontSize: "22px",
          lineHeight: "1.2",
          margin: "0 0 20px",
        }}
      >
        {heading}
      </Text>
      <Text style={{ fontSize: "15px", color: "#3A3934", margin: "0 0 12px" }}>
        {salutation}
      </Text>
      <Text style={{ fontSize: "15px", color: "#3A3934", margin: "0 0 24px" }}>
        {pageKind === "waitlist"
          ? `You joined the ${pageTitle} waitlist. We'll email you the moment there's news to share.`
          : pageKind === "lead_magnet"
            ? "Tap the button below to grab your download. The link is single-use and stays live for 30 days."
            : pageKind === "event"
              ? `You're confirmed for ${pageTitle}. Watch this inbox for the calendar invite.`
              : `Thanks for signing up to ${pageTitle}. We'll be in touch shortly.`}
      </Text>
      {leadMagnetUrl && (
        <Section style={{ margin: "0 0 24px" }}>
          <Button
            href={leadMagnetUrl}
            style={{
              backgroundColor: "#FF5B1F",
              color: "#FFFFFF",
              fontFamily: "ui-monospace,monospace",
              fontSize: "12px",
              letterSpacing: "0.12em",
              textTransform: "uppercase" as const,
              textDecoration: "none",
              padding: "12px 24px",
              display: "inline-block",
            }}
          >
            {leadMagnetLabel ?? "Download"}
          </Button>
        </Section>
      )}
      <Text style={{ fontSize: "13px", color: "#6B6862", margin: "0" }}>
        — The team at {workspaceName}
      </Text>
    </AtlasEmailShell>
  );
}

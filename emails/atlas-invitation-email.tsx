import { Button, Section, Text } from "@react-email/components";
import * as React from "react";
import { AtlasEmailShell } from "./atlas-email-shell";

interface Props {
  inviterName: string;
  organizationName: string;
  role: string;
  acceptUrl: string;
}

export function AtlasInvitationEmail({
  inviterName,
  organizationName,
  role,
  acceptUrl,
}: Props) {
  return (
    <AtlasEmailShell preview={`Invitation to join ${organizationName} on Atlas`}>
      <Text
        style={{
          fontFamily: "Georgia,serif",
          fontStyle: "italic",
          fontSize: "22px",
          lineHeight: "1.2",
          margin: "0 0 20px",
        }}
      >
        You&rsquo;re invited.
      </Text>
      <Text style={{ fontSize: "15px", color: "#3A3934", margin: "0 0 20px" }}>
        <strong>{inviterName}</strong> invited you to join{" "}
        <strong>{organizationName}</strong> on Atlas as{" "}
        <span style={{ fontFamily: "ui-monospace,monospace" }}>{role}</span>.
      </Text>
      <Section style={{ margin: "0 0 24px" }}>
        <Button
          href={acceptUrl}
          style={{
            backgroundColor: "#059669",
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
          Accept invitation
        </Button>
      </Section>
      <Text style={{ fontSize: "13px", color: "#6B6862", margin: "0" }}>
        This invitation expires in 7 days. If you weren&rsquo;t expecting it,
        you can safely ignore this email.
      </Text>
    </AtlasEmailShell>
  );
}

import { Section, Text } from "@react-email/components";
import * as React from "react";
import { AtlasEmailShell } from "./atlas-email-shell";

interface Props {
  referrerName: string;
  referredEmail: string;
  creditedAmountFormatted: string;         // "KES 500"
  totalEarnedFormatted?: string;           // running total, optional
}

export function AtlasReferralCreditedEmail({
  referrerName,
  referredEmail,
  creditedAmountFormatted,
  totalEarnedFormatted,
}: Props) {
  const salutation = referrerName ? `${referrerName},` : "Hi,";
  return (
    <AtlasEmailShell
      preview={`You've been credited ${creditedAmountFormatted}`}
    >
      <Text
        style={{
          fontFamily: "Georgia,serif",
          fontStyle: "italic",
          fontSize: "22px",
          lineHeight: "1.2",
          margin: "0 0 20px",
        }}
      >
        You&rsquo;ve been credited.
      </Text>
      <Text style={{ fontSize: "15px", color: "#3A3934", margin: "0 0 20px" }}>
        {salutation}{" "}
        <strong>{referredEmail}</strong> signed up using your invite code.
      </Text>
      <Section
        style={{
          backgroundColor: "#F4F2EE",
          padding: "22px 24px",
          textAlign: "center",
          margin: "0 0 20px",
        }}
      >
        <Text
          style={{
            fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace",
            fontSize: "28px",
            letterSpacing: "2px",
            fontWeight: 600,
            lineHeight: "1.2",
            margin: 0,
            color: "#FF5B1F",
          }}
        >
          + {creditedAmountFormatted}
        </Text>
        {totalEarnedFormatted && (
          <Text
            style={{
              fontFamily: "ui-monospace,monospace",
              fontSize: "11px",
              letterSpacing: "0.12em",
              textTransform: "uppercase" as const,
              color: "#6B6862",
              margin: "8px 0 0",
            }}
          >
            Total earned · {totalEarnedFormatted}
          </Text>
        )}
      </Section>
      <Text style={{ fontSize: "13px", color: "#6B6862", margin: "0" }}>
        Keep sharing your code. Every signup earns you more credit toward your
        Atlas subscription.
      </Text>
    </AtlasEmailShell>
  );
}

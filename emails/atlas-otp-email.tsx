import { Section, Text } from "@react-email/components";
import * as React from "react";
import { AtlasEmailShell } from "./atlas-email-shell";

interface Props {
  token: string;
  kind: "signin" | "password_reset";
  ttlMinutes: number;
}

export function AtlasOtpEmail({ token, kind, ttlMinutes }: Props) {
  const heading =
    kind === "signin" ? "Your sign-in code." : "Reset your password.";
  const helper =
    kind === "signin"
      ? "Enter this code to finish signing in. It expires in"
      : "Enter this code to reset your password. It expires in";
  return (
    <AtlasEmailShell preview={heading}>
      <Text
        style={{
          fontFamily: "Georgia,serif",
          fontStyle: "italic",
          fontSize: "22px",
          lineHeight: "1.2",
          margin: "0 0 20px",
          color: "#0A0A0B",
        }}
      >
        {heading}
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
            fontFamily:
              "ui-monospace,SFMono-Regular,Menlo,'Cascadia Mono',monospace",
            fontSize: "34px",
            letterSpacing: "10px",
            fontWeight: 600,
            lineHeight: "1",
            margin: 0,
            color: "#0A0A0B",
          }}
        >
          {token}
        </Text>
      </Section>
      <Text style={{ fontSize: "14px", color: "#3A3934", margin: "0 0 8px" }}>
        {helper} {ttlMinutes} minutes.
      </Text>
      <Text style={{ fontSize: "13px", color: "#6B6862", margin: "0" }}>
        If you didn&rsquo;t request this, you can safely ignore this email.
      </Text>
    </AtlasEmailShell>
  );
}

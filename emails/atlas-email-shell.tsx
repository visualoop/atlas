import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

interface Props {
  preview: string;
  children: React.ReactNode;
  footerNote?: string;
}

const CSS = {
  body: {
    backgroundColor: "#F4F2EE",
    color: "#0A0A0B",
    fontFamily: "system-ui,-apple-system,'Segoe UI',sans-serif",
    padding: "32px 16px",
    margin: 0,
  },
  container: {
    maxWidth: "520px",
    margin: "0 auto",
    backgroundColor: "#FFFFFF",
    border: "1px solid #E8E5DE",
    padding: "36px 40px",
  },
  wordmark: {
    fontFamily: "Georgia,'Times New Roman',serif",
    fontStyle: "italic" as const,
    fontSize: "26px",
    lineHeight: "1.1",
    margin: "0 0 6px",
    color: "#0A0A0B",
  },
  accent: {
    color: "#FF5B1F",
  },
  eyebrow: {
    fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace",
    fontSize: "10px",
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: "#6B6862",
    margin: "0 0 24px",
  },
  divider: {
    borderTop: "1px solid #E8E5DE",
    borderBottom: "none",
    borderLeft: "none",
    borderRight: "none",
    margin: "28px 0",
  },
  footer: {
    fontSize: "11px",
    color: "#9C978E",
    lineHeight: "1.6",
    margin: "12px 0 0",
  },
};

export function AtlasEmailShell({ preview, children, footerNote }: Props) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={CSS.body}>
        <Container style={CSS.container}>
          <Text style={CSS.wordmark}>
            Atlas<span style={CSS.accent}>.</span>
          </Text>
          <Text style={CSS.eyebrow}>{preview}</Text>
          {children}
          <Hr style={CSS.divider} />
          <Text style={CSS.footer}>
            {footerNote ??
              "Sent by Atlas — the operating system for a founder. If this wasn't you, ignore this email."}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

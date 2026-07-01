import { Button, Section, Text } from "@react-email/components";
import * as React from "react";
import { AtlasEmailShell } from "./atlas-email-shell";

interface Props {
  hostName: string;                 // "Blyss" or workspace name
  attendeeName?: string;
  meetingTitle: string;
  startAtIso: string;
  durationMinutes: number;
  timezone: string;
  conferenceUrl?: string;
  location?: string;
  note?: string;
}

export function AtlasMeetingConfirmationEmail({
  hostName,
  attendeeName,
  meetingTitle,
  startAtIso,
  durationMinutes,
  timezone,
  conferenceUrl,
  location,
  note,
}: Props) {
  const dt = new Date(startAtIso);
  const dateStr = dt.toLocaleDateString("en-KE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeStr = dt.toLocaleTimeString("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  });

  return (
    <AtlasEmailShell preview={`Booked · ${meetingTitle}`}>
      <Text
        style={{
          fontFamily: "Georgia,serif",
          fontStyle: "italic",
          fontSize: "22px",
          lineHeight: "1.2",
          margin: "0 0 6px",
        }}
      >
        {attendeeName ? `${attendeeName}, you're booked.` : "You're booked."}
      </Text>
      <Text style={{ fontSize: "14px", color: "#6B6862", margin: "0 0 24px" }}>
        with {hostName}
      </Text>
      <Section
        style={{
          borderLeft: "3px solid #FF5B1F",
          padding: "12px 0 12px 16px",
          margin: "0 0 24px",
        }}
      >
        <Text
          style={{
            fontSize: "16px",
            fontWeight: 600,
            margin: "0 0 6px",
          }}
        >
          {meetingTitle}
        </Text>
        <Text
          style={{
            fontFamily: "ui-monospace,monospace",
            fontSize: "13px",
            color: "#3A3934",
            margin: "0 0 4px",
          }}
        >
          {dateStr}
        </Text>
        <Text
          style={{
            fontFamily: "ui-monospace,monospace",
            fontSize: "13px",
            color: "#3A3934",
            margin: "0",
          }}
        >
          {timeStr} · {durationMinutes} min · {timezone}
        </Text>
      </Section>
      {conferenceUrl && (
        <Section style={{ margin: "0 0 20px" }}>
          <Button
            href={conferenceUrl}
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
            Join meeting
          </Button>
        </Section>
      )}
      {location && (
        <Text style={{ fontSize: "14px", color: "#3A3934", margin: "0 0 12px" }}>
          Location: <strong>{location}</strong>
        </Text>
      )}
      {note && (
        <Text
          style={{
            fontSize: "13px",
            color: "#6B6862",
            fontStyle: "italic",
            margin: "16px 0 0",
            padding: "12px",
            backgroundColor: "#F4F2EE",
          }}
        >
          Your note: {note}
        </Text>
      )}
      <Text style={{ fontSize: "13px", color: "#6B6862", margin: "24px 0 0" }}>
        Need to reschedule? Reply to this email.
      </Text>
    </AtlasEmailShell>
  );
}

/**
 * Public API — /api/v1/contacts
 *
 * Bearer-token auth via publicApiKeys.tokenHash lookup.
 * Scopes: 'contacts:read' for GET, 'contacts:write' for POST.
 */

import type { NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

export const runtime = "nodejs";

const convex = new ConvexHttpClient(
  process.env.NEXT_PUBLIC_CONVEX_PUBLIC_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "",
);

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function authenticate(req: NextRequest, requiredScope: string) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: "missing_token", status: 401 as const };
  }
  const token = authHeader.slice(7);
  const tokenHash = await sha256Hex(token);
  const key = await convex.query(api.publicApi.resolveKey, {
    tokenHash,
    scope: requiredScope,
  });
  if (!key) return { error: "invalid_or_insufficient_scope", status: 403 as const };
  return { workspaceId: key.workspaceId, keyId: key._id, status: 200 as const };
}

export async function GET(req: NextRequest) {
  const auth = await authenticate(req, "contacts:read");
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const cursor = url.searchParams.get("cursor") ?? undefined;

  const result = await convex.query(api.publicApi.listContacts, {
    workspaceId: auth.workspaceId,
    limit,
    cursor,
  });
  await convex.mutation(api.publicApi.recordUsage, { keyId: auth.keyId });

  return Response.json(result, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req, "contacts:write");
  if ("error" in auth) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  let body: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.firstName) {
    return Response.json({ error: "firstName is required" }, { status: 400 });
  }

  const id = await convex.mutation(api.publicApi.createContact, {
    workspaceId: auth.workspaceId,
    firstName: body.firstName,
    lastName: body.lastName,
    email: body.email,
    phone: body.phone,
  });
  await convex.mutation(api.publicApi.recordUsage, { keyId: auth.keyId });

  return Response.json({ id }, { status: 201 });
}

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

async function auth(req: NextRequest, scope: string) {
  const h = req.headers.get("authorization");
  if (!h?.startsWith("Bearer ")) return { error: "missing_token", status: 401 as const };
  const key = await convex.query(api.publicApi.resolveKey, {
    tokenHash: await sha256Hex(h.slice(7)),
    scope,
  });
  if (!key) return { error: "invalid", status: 403 as const };
  return { workspaceId: key.workspaceId, keyId: key._id, status: 200 as const };
}

export async function GET(req: NextRequest) {
  const a = await auth(req, "companies:read");
  if ("error" in a) return Response.json({ error: a.error }, { status: a.status });
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const result = await convex.query(api.publicApi.listCompanies, {
    workspaceId: a.workspaceId,
    limit,
    cursor,
  });
  await convex.mutation(api.publicApi.recordUsage, { keyId: a.keyId });
  return Response.json(result);
}

export async function POST(req: NextRequest) {
  const a = await auth(req, "companies:write");
  if ("error" in a) return Response.json({ error: a.error }, { status: a.status });
  const body = (await req.json()) as { name?: string; domain?: string };
  if (!body.name) return Response.json({ error: "name is required" }, { status: 400 });
  const id = await convex.mutation(api.publicApi.createCompany, {
    workspaceId: a.workspaceId,
    name: body.name,
    domain: body.domain,
  });
  await convex.mutation(api.publicApi.recordUsage, { keyId: a.keyId });
  return Response.json({ id }, { status: 201 });
}

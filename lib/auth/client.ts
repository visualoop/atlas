"use client";
import { createAuthClient } from "better-auth/react";
import { organizationClient, twoFactorClient, magicLinkClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [organizationClient(), twoFactorClient(), magicLinkClient()],
});

export const { useSession, signIn, signOut, signUp, organization } = authClient;

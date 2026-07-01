/**
 * Referrals — user-to-user invite code + credit system.
 *
 * Model:
 *   - Every user has a unique 8-char referralCode (auto-generated on
 *     first bootstrap of their userProfile).
 *   - New users can pass a code at signup. On the first call to
 *     `bootstrapMyProfile`, we:
 *       1. Ensure the caller has a userProfile row (create if missing).
 *       2. Ensure they have a referralCode.
 *       3. If they passed a code AND haven't already claimed one AND
 *          the code resolves to a different, non-archived user →
 *          create a referralClaim + credit the referrer + email them.
 *
 * Credit amount: `REWARD_CENTS` (default KES 500 = 50_000 cents).
 * Configure via Convex env var `REFERRAL_REWARD_CENTS` if you want
 * something else without redeploying.
 */

import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUser } from "./lib/authHelpers";
import type { Doc, Id } from "./_generated/dataModel";

const DEFAULT_REWARD_CENTS = 50_000n; // KES 500
const DEFAULT_CURRENCY = "KES";

/* ============================================================ */
/* Reads                                                          */
/* ============================================================ */

export const myReferralInfo = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();

    // Aggregate my claims
    const claims = await ctx.db
      .query("referralClaims")
      .withIndex("by_referrer_time", (q) => q.eq("referrerUserId", user._id))
      .collect();
    const credited = claims.filter((c) => c.status === "credited");
    const totalEarnedCents = credited.reduce(
      (s, c) => s + c.creditedAmountCents,
      0n,
    );

    return {
      referralCode: profile?.referralCode ?? null,
      referralCreditsCents: (profile?.referralCreditsCents ?? 0n).toString(),
      currency: profile?.referralCurrency ?? DEFAULT_CURRENCY,
      claimsCount: claims.length,
      creditedCount: credited.length,
      totalEarnedCents: totalEarnedCents.toString(),
    };
  },
});

export const listMyClaims = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const claims = await ctx.db
      .query("referralClaims")
      .withIndex("by_referrer_time", (q) => q.eq("referrerUserId", user._id))
      .order("desc")
      .take(200);

    // Resolve the referred user names for display
    const withNames = await Promise.all(
      claims.map(async (c) => {
        const referredUser = await ctx.db.get(c.referredUserId);
        const referredProfile = referredUser
          ? await ctx.db
              .query("userProfiles")
              .withIndex("by_userId", (q) => q.eq("userId", c.referredUserId))
              .first()
          : null;
        return {
          ...c,
          creditedAmountCents: c.creditedAmountCents.toString(),
          referredUserEmail: (referredUser as { email?: string } | null)?.email ?? null,
          referredUserName: referredProfile?.fullName ?? null,
        };
      }),
    );
    return withNames;
  },
});

/** Public — resolve who owns a code, so the login page can show "invited by X". */
export const resolveByCode = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const normalized = args.code.trim().toUpperCase();
    if (normalized.length < 4) return null;
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_referral_code", (q) => q.eq("referralCode", normalized))
      .first();
    if (!profile) return null;
    const user = await ctx.db.get(profile.userId);
    return {
      referrerName: profile.fullName ?? (user as { name?: string } | null)?.name ?? null,
      referrerEmail: (user as { email?: string } | null)?.email ?? null,
    };
  },
});

/* ============================================================ */
/* Bootstrap + claim                                              */
/* ============================================================ */

/**
 * Called by the frontend right after a successful signup / first
 * login. Ensures the user has a profile + a referral code, and if
 * a code was provided, claims it (once).
 *
 * Idempotent — safe to call on every page load.
 */
export const bootstrapMyProfile = mutation({
  args: {
    referralCode: v.optional(v.string()),
    fullName: v.optional(v.string()),
    timezone: v.optional(v.string()),
    locale: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    // Load or create profile
    let profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first();

    if (!profile) {
      const code = await generateUniqueReferralCode(ctx);
      const id = await ctx.db.insert("userProfiles", {
        userId: user._id,
        fullName: args.fullName,
        timezone: args.timezone ?? "Africa/Nairobi",
        locale: args.locale ?? "en",
        referralCode: code,
        referralCreditsCents: 0n,
        referralCurrency: DEFAULT_CURRENCY,
      });
      profile = await ctx.db.get(id);
    } else if (!profile.referralCode) {
      const code = await generateUniqueReferralCode(ctx);
      await ctx.db.patch(profile._id, { referralCode: code });
      profile = await ctx.db.get(profile._id);
    }

    // Claim the referral code if provided (and not already claimed)
    let claimResult: {
      claimed: boolean;
      reason?: string;
      referrerEmail?: string;
    } = { claimed: false };
    if (args.referralCode && profile) {
      claimResult = await tryClaimReferral(ctx, user._id, args.referralCode);
    }

    return {
      referralCode: profile?.referralCode ?? null,
      claim: claimResult,
    };
  },
});

/* ============================================================ */
/* Internals                                                     */
/* ============================================================ */

async function generateUniqueReferralCode(
  ctx: QueryCtx | MutationCtx,
): Promise<string> {
  // 8-char alphanumeric, unambiguous alphabet (no O/0/I/1/l)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 8; attempt++) {
    let code = "";
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const exists = await ctx.db
      .query("userProfiles")
      .withIndex("by_referral_code", (q) => q.eq("referralCode", code))
      .first();
    if (!exists) return code;
  }
  throw new ConvexError({
    code: "REFERRAL_CODE_GEN_FAILED",
    message: "Could not generate a unique referral code.",
  });
}

async function tryClaimReferral(
  ctx: MutationCtx,
  referredUserId: Id<"users">,
  rawCode: string,
): Promise<{ claimed: boolean; reason?: string; referrerEmail?: string }> {
  const code = rawCode.trim().toUpperCase();
  if (code.length < 4) return { claimed: false, reason: "invalid_code" };

  // Already claimed?
  const already = await ctx.db
    .query("referralClaims")
    .withIndex("by_referred", (q) => q.eq("referredUserId", referredUserId))
    .first();
  if (already) return { claimed: false, reason: "already_claimed" };

  // Find referrer
  const referrerProfile = await ctx.db
    .query("userProfiles")
    .withIndex("by_referral_code", (q) => q.eq("referralCode", code))
    .first();
  if (!referrerProfile) return { claimed: false, reason: "code_not_found" };
  if (referrerProfile.userId === referredUserId) {
    return { claimed: false, reason: "cannot_self_refer" };
  }

  // Amount
  const rewardCents = readRewardCents();

  // Create the claim
  await ctx.db.insert("referralClaims", {
    referrerUserId: referrerProfile.userId,
    referredUserId,
    referralCode: code,
    creditedAmountCents: rewardCents,
    currency: DEFAULT_CURRENCY,
    status: "credited",
    claimedAt: Date.now(),
  });

  // Credit the referrer
  await ctx.db.patch(referrerProfile._id, {
    referralCreditsCents:
      (referrerProfile.referralCreditsCents ?? 0n) + rewardCents,
    referralCurrency: referrerProfile.referralCurrency ?? DEFAULT_CURRENCY,
  });

  // Set referredBy on new user's profile
  const newUserProfile = await ctx.db
    .query("userProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", referredUserId))
    .first();
  if (newUserProfile && !newUserProfile.referredByUserId) {
    await ctx.db.patch(newUserProfile._id, {
      referredByUserId: referrerProfile.userId,
    });
  }

  // Notify referrer via email — scheduled so we don't block signup
  const referrerUser = await ctx.db.get(referrerProfile.userId);
  const referredUser = await ctx.db.get(referredUserId);
  const referrerEmail = (referrerUser as { email?: string } | null)?.email;
  if (referrerEmail) {
    await ctx.scheduler.runAfter(0, internal.referralsActions.notifyReferrer, {
      referrerEmail,
      referrerName: referrerProfile.fullName ?? "",
      referredEmail: (referredUser as { email?: string } | null)?.email ?? "",
      creditedAmountCents: rewardCents.toString(),
      currency: DEFAULT_CURRENCY,
    });
  }

  return { claimed: true, referrerEmail };
}

function readRewardCents(): bigint {
  const raw = process.env.REFERRAL_REWARD_CENTS;
  if (!raw) return DEFAULT_REWARD_CENTS;
  try {
    const n = BigInt(raw);
    return n > 0n ? n : DEFAULT_REWARD_CENTS;
  } catch {
    return DEFAULT_REWARD_CENTS;
  }
}

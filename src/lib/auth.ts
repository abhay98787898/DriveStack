import { betterAuth } from "better-auth/minimal";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "@/lib/db";

const baseURL =
  process.env.BETTER_AUTH_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000";

export const auth = betterAuth({
  appName: "DriveStack",
  baseURL,
  secret:
    process.env.BETTER_AUTH_SECRET ||
    (process.env.NODE_ENV !== "production"
      ? "drivestack-local-development-secret-do-not-use-in-production"
      : undefined),
  database: prismaAdapter(db, { provider: "sqlite" }),
  trustedOrigins: [baseURL],
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      prompt: "select_account",
      requireEmailVerification: true,
    },
  },
  user: {
    validateUserInfo: ({ user, source }) => {
      const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
      const requestedEmail = user.email?.trim().toLowerCase();

      if (
        source.oauth?.providerId !== "google" ||
        !ownerEmail ||
        !requestedEmail ||
        requestedEmail !== ownerEmail
      ) {
        return {
          error: "owner_only",
          errorDescription: "This DriveStack instance is private.",
        };
      }
    },
  },
  account: {
    encryptOAuthTokens: true,
    accountLinking: {
      enabled: false,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
});

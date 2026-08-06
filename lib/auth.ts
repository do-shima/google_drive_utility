import type { Account, NextAuthOptions, Session } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import type { JWT } from "next-auth/jwt";
import { emailDomain, isDomain, isEmail, normalizeEmail } from "./input";

type AuthPolicy = {
  allowedDomain: string;
  allowedOperators: Set<string>;
};

export function getAuthPolicy(env: Readonly<Record<string, string | undefined>> = process.env): AuthPolicy | null {
  const required = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "NEXTAUTH_SECRET", "NEXTAUTH_URL", "ALLOWED_DOMAIN", "ALLOWED_OPERATOR_EMAILS"] as const;
  if (required.some((key) => !env[key]?.trim())) return null;

  const allowedDomain = env.ALLOWED_DOMAIN!.trim().toLowerCase();
  const allowedOperators = new Set(env.ALLOWED_OPERATOR_EMAILS!.split(",").map(normalizeEmail).filter(isEmail));
  if (!isDomain(allowedDomain) || allowedOperators.size === 0) return null;
  if ([...allowedOperators].some((email) => emailDomain(email) !== allowedDomain)) return null;

  try {
    const nextAuthUrl = new URL(env.NEXTAUTH_URL!);
    if (nextAuthUrl.protocol !== "https:" && nextAuthUrl.hostname !== "localhost") return null;
  } catch {
    return null;
  }
  return { allowedDomain, allowedOperators };
}

type GoogleProfile = { email?: string; email_verified?: boolean; hd?: string };

export function isAuthorizedGoogleProfile(profile: unknown, policy: AuthPolicy | null): boolean {
  if (!policy || !profile || typeof profile !== "object") return false;
  const candidate = profile as Partial<GoogleProfile>;
  if (candidate.email_verified !== true || typeof candidate.email !== "string" || typeof candidate.hd !== "string") return false;
  const email = normalizeEmail(candidate.email);
  return candidate.hd.toLowerCase() === policy.allowedDomain && policy.allowedOperators.has(email);
}

export function clientSession(session: Session): Session {
  return { user: session.user, expires: session.expires };
}

type ServerTokenState =
  | { ok: true; accessToken: string }
  | { ok: false; code: "AUTH_REQUIRED" | "AUTH_EXPIRED" };

export function serverTokenState(token: JWT | null, nowSeconds = Math.floor(Date.now() / 1000)): ServerTokenState {
  if (!token?.googleAccessToken || typeof token.googleAccessTokenExpiresAt !== "number") return { ok: false, code: "AUTH_REQUIRED" };
  if (token.googleAccessTokenExpiresAt <= nowSeconds) return { ok: false, code: "AUTH_EXPIRED" };
  return { ok: true, accessToken: token.googleAccessToken };
}

function saveGoogleToken(token: JWT, account: Account | null): JWT {
  if (!account) return token;
  if (typeof account.access_token === "string" && typeof account.expires_at === "number") {
    token.googleAccessToken = account.access_token;
    token.googleAccessTokenExpiresAt = account.expires_at;
  } else {
    delete token.googleAccessToken;
    delete token.googleAccessTokenExpiresAt;
  }
  return token;
}

const policy = getAuthPolicy();

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      authorization: {
        params: {
          response_type: "code",
          hd: policy?.allowedDomain,
          scope: "openid email profile https://www.googleapis.com/auth/drive",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ profile }) {
      return isAuthorizedGoogleProfile(profile, getAuthPolicy());
    },
    async jwt({ token, account }) {
      return saveGoogleToken(token, account);
    },
    async session({ session }) {
      return clientSession(session);
    },
  },
  pages: { error: "/" },
  secret: process.env.NEXTAUTH_SECRET,
};

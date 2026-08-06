import { describe, expect, it } from "vitest";
import type { Session } from "next-auth";
import { clientSession, getAuthPolicy, isAuthorizedGoogleProfile, serverTokenState } from "@/lib/auth";

const env = {
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "secret",
  NEXTAUTH_SECRET: "next-secret",
  NEXTAUTH_URL: "https://utility.example.ac.jp",
  ALLOWED_DOMAIN: "example.ac.jp",
  ALLOWED_OPERATOR_EMAILS: "teacher@example.ac.jp,staff@example.ac.jp",
};

describe("operator authentication", () => {
  const policy = getAuthPolicy(env);

  it("accepts only a verified profile with exact hd and operator email", () => {
    expect(isAuthorizedGoogleProfile({ email: "Teacher@Example.ac.jp", email_verified: true, hd: "example.ac.jp" }, policy)).toBe(true);
    expect(isAuthorizedGoogleProfile({ email: "teacher@example.ac.jp", email_verified: false, hd: "example.ac.jp" }, policy)).toBe(false);
    expect(isAuthorizedGoogleProfile({ email: "other@example.ac.jp", email_verified: true, hd: "example.ac.jp" }, policy)).toBe(false);
    expect(isAuthorizedGoogleProfile({ email: "teacher@example.ac.jp.attacker.test", email_verified: true, hd: "example.ac.jp.attacker.test" }, policy)).toBe(false);
  });

  it("fails closed when required configuration is missing", () => {
    expect(getAuthPolicy({ ...env, ALLOWED_OPERATOR_EMAILS: "" })).toBeNull();
  });

  it("does not expose the access token in the client session", () => {
    const internal = { user: { email: "teacher@example.ac.jp" }, expires: "2099-01-01", accessToken: "secret-token" } as Session & { accessToken: string };
    expect(clientSession(internal)).toEqual({ user: internal.user, expires: internal.expires });
    expect(clientSession(internal)).not.toHaveProperty("accessToken");
  });

  it("rejects an expired server-side token", () => {
    expect(serverTokenState({ googleAccessToken: "secret", googleAccessTokenExpiresAt: 99 }, 100)).toEqual({ ok: false, code: "AUTH_EXPIRED" });
  });
});

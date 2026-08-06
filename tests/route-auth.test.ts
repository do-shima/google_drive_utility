import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

const previousEnv: Record<string, string | undefined> = {};
const requiredEnv = {
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "secret",
  NEXTAUTH_SECRET: "next-secret",
  NEXTAUTH_URL: "https://utility.example.ac.jp",
  ALLOWED_DOMAIN: "example.ac.jp",
  ALLOWED_OPERATOR_EMAILS: "teacher@example.ac.jp",
};

describe("Drive route authentication", () => {
  beforeAll(() => {
    for (const [key, value] of Object.entries(requiredEnv)) {
      previousEnv[key] = process.env[key];
      process.env[key] = value;
    }
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("returns a safe 401 when the Google access token has expired", async () => {
    vi.mocked(getToken).mockResolvedValue({ email: "teacher@example.ac.jp", googleAccessToken: "not-returned", googleAccessTokenExpiresAt: 1 });
    const { POST } = await import("@/app/api/drive/route");
    const response = await POST(new NextRequest("http://localhost/api/drive", { method: "POST", body: JSON.stringify({ action: "get_links", targetId: "abcdefghijk" }) }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "AUTH_EXPIRED", message: "認証の有効期限が切れました。再度ログインしてください。" } });
  });
});

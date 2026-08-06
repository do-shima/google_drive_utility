import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { google } from "googleapis";
import { getAuthPolicy, serverTokenState } from "@/lib/auth";
import { addPermissions, copyItems, createFolders, getDriveLinks, safeDriveError } from "@/lib/drive";
import { normalizeEmail } from "@/lib/input";
import { validateDriveRequest } from "@/lib/validation";

function errorResponse(code: string, message: string, status: number, correlationId?: string) {
  return NextResponse.json({ error: { code, message, correlationId } }, { status });
}

function batchResponse(outcome: { authExpired: boolean; results: unknown[]; summary: unknown }) {
  if (outcome.authExpired) {
    return NextResponse.json({ error: { code: "AUTH_EXPIRED", message: "認証の有効期限が切れました。再度ログインしてください。" }, ...outcome }, { status: 401 });
  }
  return NextResponse.json(outcome);
}

export async function POST(request: NextRequest) {
  const correlationId = randomUUID();
  const policy = getAuthPolicy();
  if (!policy || !process.env.NEXTAUTH_SECRET) {
    return errorResponse("SERVER_MISCONFIGURED", "サーバーの認証設定が完了していません。", 503, correlationId);
  }

  let token;
  try {
    token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  } catch {
    return errorResponse("AUTH_REQUIRED", "再度ログインしてください。", 401);
  }
  if (typeof token?.email !== "string" || !policy.allowedOperators.has(normalizeEmail(token.email))) {
    return errorResponse("AUTH_REQUIRED", "再度ログインしてください。", 401);
  }
  const tokenState = serverTokenState(token);
  if (!tokenState.ok) {
    const message = tokenState.code === "AUTH_EXPIRED" ? "認証の有効期限が切れました。再度ログインしてください。" : "再度ログインしてください。";
    return errorResponse(tokenState.code, message, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_JSON", "リクエストの形式が不正です。", 400, correlationId);
  }
  const validation = validateDriveRequest(body, policy.allowedDomain);
  if (!validation.ok) return errorResponse(validation.code, validation.message, 400, correlationId);

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: tokenState.accessToken });
  const drive = google.drive({ version: "v3", auth: oauth2Client });

  try {
    switch (validation.value.action) {
      case "get_links":
        return NextResponse.json({ files: await getDriveLinks(drive, validation.value.targetId) });
      case "create_folders": {
        const outcome = await createFolders(drive, validation.value.destinationId, validation.value.names);
        return batchResponse(outcome);
      }
      case "copy_items": {
        const outcome = await copyItems(drive, validation.value.sourceId, validation.value.destinationId, validation.value.names);
        return batchResponse(outcome);
      }
      case "add_permissions_bulk": {
        const outcome = await addPermissions(drive, validation.value.items, validation.value.role);
        return batchResponse(outcome);
      }
    }
  } catch (error: unknown) {
    const safe = safeDriveError(error);
    console.error("Drive request failed", { correlationId, code: safe.code });
    return errorResponse(safe.code, safe.message, safe.status, correlationId);
  }
}

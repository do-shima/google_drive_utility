import { LIMITS } from "./contracts";
import { emailDomain, isDriveId, isEmail, normalizeEmail } from "./input";

export type DriveRequest =
  | { action: "get_links"; targetId: string }
  | { action: "create_folders"; destinationId: string; names: string[] }
  | { action: "copy_items"; sourceId: string; destinationId: string; names: string[] }
  | { action: "add_permissions_bulk"; items: Array<{ targetId: string; emails: string[] }>; role: "editor" | "viewer" };

export type ValidationResult =
  | { ok: true; value: DriveRequest }
  | { ok: false; code: "INVALID_REQUEST" | "LIMIT_EXCEEDED"; message: string };

function invalid(message: string): ValidationResult {
  return { ok: false, code: "INVALID_REQUEST", message };
}

function limited(message: string): ValidationResult {
  return { ok: false, code: "LIMIT_EXCEEDED", message };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseNames(value: unknown): { names: string[] } | ValidationResult {
  if (!Array.isArray(value)) return invalid("名前一覧は配列で指定してください。");
  if (value.length === 0) return invalid("名前を1件以上指定してください。");
  if (value.length > LIMITS.namesPerRequest) return limited(`名前は1回につき${LIMITS.namesPerRequest}件までです。`);
  if (value.some((name) => typeof name !== "string" || !name.trim() || name.trim().length > 255)) {
    return invalid("名前には1文字以上255文字以下の文字列を指定してください。");
  }
  const names = value.map((name) => (name as string).trim());
  if (new Set(names).size !== names.length) return invalid("入力内に重複する名前があります。");
  return { names };
}

export function validateDriveRequest(body: unknown, allowedDomain: string): ValidationResult {
  const value = objectValue(body);
  if (!value || typeof value.action !== "string") return invalid("actionを指定してください。");

  if (value.action === "get_links") {
    return isDriveId(value.targetId) ? { ok: true, value: { action: value.action, targetId: value.targetId } } : invalid("Drive IDが不正です。");
  }

  if (value.action === "create_folders" || value.action === "copy_items") {
    if (!isDriveId(value.destinationId)) return invalid("保存先のDrive IDが不正です。");
    const parsedNames = parseNames(value.names);
    if (!("names" in parsedNames)) return parsedNames;
    if (value.action === "create_folders") {
      return { ok: true, value: { action: value.action, destinationId: value.destinationId, names: parsedNames.names } };
    }
    if (!isDriveId(value.sourceId)) return invalid("コピー元のDrive IDが不正です。");
    return { ok: true, value: { action: value.action, sourceId: value.sourceId, destinationId: value.destinationId, names: parsedNames.names } };
  }

  if (value.action === "add_permissions_bulk") {
    if (value.role !== "editor" && value.role !== "viewer") return invalid("roleはeditorまたはviewerを指定してください。");
    if (!Array.isArray(value.items) || value.items.length === 0) return invalid("権限付与対象は配列で1件以上指定してください。");
    if (value.items.length > LIMITS.permissionTargetsPerRequest) return limited(`対象ファイルは1回につき${LIMITS.permissionTargetsPerRequest}件までです。`);

    const items: Array<{ targetId: string; emails: string[] }> = [];
    const targetIds = new Set<string>();
    let mutationCount = 0;
    for (const rawItem of value.items) {
      const item = objectValue(rawItem);
      if (!item || !isDriveId(item.targetId) || !Array.isArray(item.emails) || item.emails.length === 0) {
        return invalid("各対象には有効なDrive IDとメールアドレス配列が必要です。");
      }
      if (targetIds.has(item.targetId)) return invalid("同じ対象ファイルが複数回指定されています。");
      targetIds.add(item.targetId);
      if (item.emails.length > LIMITS.emailsPerTarget) return limited(`1ファイル当たりのメールアドレスは${LIMITS.emailsPerTarget}件までです。`);

      const emails = [...new Set(item.emails.map((email) => typeof email === "string" ? normalizeEmail(email) : ""))];
      if (emails.some((email) => !isEmail(email))) return invalid("メールアドレスの形式が不正です。");
      if (emails.some((email) => emailDomain(email) !== allowedDomain)) return invalid("学外ドメインへの権限付与はできません。");
      mutationCount += emails.length;
      items.push({ targetId: item.targetId, emails });
    }
    if (mutationCount > LIMITS.permissionMutationsPerRequest) {
      return limited(`権限付与は1回につき合計${LIMITS.permissionMutationsPerRequest}件までです。`);
    }
    return { ok: true, value: { action: value.action, items, role: value.role } };
  }

  return invalid("許可されていないactionです。");
}

import type { drive_v3 } from "googleapis";
import { LIMITS, type DriveFileResult, type ItemResult, type PermissionResult, type ResultSummary } from "./contracts";
import { normalizeEmail } from "./input";

const FOLDER_MIME = "application/vnd.google-apps.folder";

export class SafeDriveError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; response?: { status?: unknown } };
  const value = candidate.response?.status ?? candidate.code;
  return typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;
}

function errorReasons(error: unknown): string[] {
  if (!error || typeof error !== "object") return [];
  const data = (error as { response?: { data?: { error?: { errors?: Array<{ reason?: unknown }> } } } }).response?.data;
  return data?.error?.errors?.flatMap((entry) => typeof entry.reason === "string" ? [entry.reason] : []) ?? [];
}

function retryable(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === 429 || (status !== null && [500, 502, 503, 504].includes(status))) return true;
  return status === 403 && errorReasons(error).some((reason) => ["rateLimitExceeded", "userRateLimitExceeded", "sharingRateLimitExceeded"].includes(reason));
}

export async function withDriveRetry<T>(operation: () => Promise<T>, sleep: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)), random = Math.random): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      if (attempt >= maxAttempts || !retryable(error)) throw error;
      await sleep(200 * 2 ** (attempt - 1) + Math.floor(random() * 100));
    }
  }
}

export function safeDriveError(error: unknown): SafeDriveError {
  if (error instanceof SafeDriveError) return error;
  const status = errorStatus(error);
  if (status === 401) return new SafeDriveError("AUTH_EXPIRED", 401, "認証の有効期限が切れました。再度ログインしてください。");
  if (status === 403) return new SafeDriveError("PERMISSION_DENIED", 403, "対象を操作する権限がありません。");
  if (status === 404) return new SafeDriveError("NOT_FOUND", 404, "対象が見つかりません。");
  if (status === 429 || (status !== null && status >= 500)) return new SafeDriveError("DRIVE_TEMPORARY_ERROR", 503, "Google Driveが一時的に利用できません。時間をおいて再実行してください。");
  return new SafeDriveError("DRIVE_ERROR", 500, "Google Driveの処理に失敗しました。");
}

type SnapshotNode = {
  id: string;
  name: string;
  mimeType: string;
  children: SnapshotNode[];
};

function completeFile(file: drive_v3.Schema$File): file is drive_v3.Schema$File & { id: string; name: string; mimeType: string } {
  return typeof file.id === "string" && typeof file.name === "string" && typeof file.mimeType === "string";
}

export async function listAllChildren(drive: drive_v3.Drive, parentId: string): Promise<Array<drive_v3.Schema$File & { id: string; name: string; mimeType: string }>> {
  const files: Array<drive_v3.Schema$File & { id: string; name: string; mimeType: string }> = [];
  let pageToken: string | undefined;
  do {
    const response = await withDriveRetry(() => drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields: "nextPageToken,incompleteSearch,files(id,name,mimeType,webViewLink,parents,capabilities(canCopy,canAddChildren))",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      orderBy: "folder,name_natural",
      pageSize: 1000,
      pageToken,
    }));
    if (response.data.incompleteSearch) throw new SafeDriveError("INCOMPLETE_SEARCH", 502, "Driveの検索結果が不完全なため処理を中止しました。");
    const pageFiles = response.data.files ?? [];
    if (!pageFiles.every(completeFile)) throw new SafeDriveError("INVALID_DRIVE_RESPONSE", 502, "Driveから不完全な応答が返されました。");
    files.push(...pageFiles);
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  return files;
}

async function getFile(drive: drive_v3.Drive, fileId: string): Promise<drive_v3.Schema$File & { id: string; name: string; mimeType: string }> {
  const response = await withDriveRetry(() => drive.files.get({
    fileId,
    fields: "id,name,mimeType,webViewLink,parents,capabilities(canCopy,canAddChildren)",
    supportsAllDrives: true,
  }));
  if (!completeFile(response.data)) throw new SafeDriveError("INVALID_DRIVE_RESPONSE", 502, "Driveから不完全な応答が返されました。");
  return response.data;
}

export async function getDriveLinks(drive: drive_v3.Drive, targetId: string): Promise<DriveFileResult[]> {
  const target = await getFile(drive, targetId);
  if (target.mimeType !== FOLDER_MIME) throw new SafeDriveError("NOT_A_FOLDER", 400, "指定された対象はフォルダではありません。");
  const children = await listAllChildren(drive, targetId);
  return children.map((file) => ({ id: file.id, name: file.name, mimeType: file.mimeType, webViewLink: file.webViewLink ?? "" }));
}

async function assertDestination(drive: drive_v3.Drive, destinationId: string): Promise<void> {
  const destination = await getFile(drive, destinationId);
  if (destination.mimeType !== FOLDER_MIME) throw new SafeDriveError("NOT_A_FOLDER", 400, "保存先はフォルダを指定してください。");
  if (destination.capabilities?.canAddChildren !== true) throw new SafeDriveError("DESTINATION_NOT_WRITABLE", 403, "保存先フォルダへ追加する権限がありません。");
}

async function existingNames(drive: drive_v3.Drive, destinationId: string): Promise<Set<string>> {
  return new Set((await listAllChildren(drive, destinationId)).map((file) => file.name));
}

function summarize(results: Array<{ status: "success" | "failed" | "skipped" }>): ResultSummary {
  return {
    succeeded: results.filter((result) => result.status === "success").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
  };
}

function failure(name: string, index: number, error: unknown, partial = false): ItemResult {
  const safe = safeDriveError(error);
  return {
    key: String(index),
    name,
    status: "failed",
    code: safe.code,
    message: partial ? `${safe.message} 一部が作成済みの可能性があります。再実行前に保存先を確認してください。` : safe.message,
  };
}

export async function createFolders(drive: drive_v3.Drive, destinationId: string, names: string[]): Promise<{ results: ItemResult[]; summary: ResultSummary; authExpired: boolean }> {
  await assertDestination(drive, destinationId);
  const collisions = await existingNames(drive, destinationId);
  const results: ItemResult[] = [];
  let authExpired = false;
  for (const [index, name] of names.entries()) {
    if (authExpired) {
      results.push({ key: String(index), name, status: "skipped", code: "AUTH_EXPIRED", message: "認証切れのため未実行です。" });
      continue;
    }
    if (collisions.has(name)) {
      results.push({ key: String(index), name, status: "skipped", code: "NAME_CONFLICT", message: "保存先に同名アイテムが存在するためスキップしました。" });
      continue;
    }
    try {
      const response = await withDriveRetry(() => drive.files.create({
        requestBody: { name, mimeType: FOLDER_MIME, parents: [destinationId] },
        fields: "id,name,mimeType,webViewLink",
        supportsAllDrives: true,
      }));
      results.push({ key: String(index), name, status: "success", code: "CREATED", message: "作成しました。", webViewLink: response.data.webViewLink ?? undefined });
    } catch (error: unknown) {
      const result = failure(name, index, error);
      results.push(result);
      authExpired = result.code === "AUTH_EXPIRED";
    }
  }
  return { results, summary: summarize(results), authExpired };
}

async function assertNotDescendant(drive: drive_v3.Drive, sourceId: string, destinationId: string): Promise<void> {
  if (sourceId === destinationId) throw new SafeDriveError("COPY_INTO_SELF", 400, "コピー元と保存先に同じフォルダは指定できません。");
  const pending = [destinationId];
  const visited = new Set<string>();
  while (pending.length) {
    const currentId = pending.pop()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    if (visited.size > 100) throw new SafeDriveError("ANCESTRY_LIMIT", 400, "保存先の親階層を安全に確認できませんでした。");
    if (currentId === sourceId) throw new SafeDriveError("COPY_INTO_DESCENDANT", 400, "コピー元の配下にはコピーできません。");
    const current = await getFile(drive, currentId);
    pending.push(...(current.parents ?? []));
  }
}

async function snapshotSource(drive: drive_v3.Drive, source: drive_v3.Schema$File & { id: string; name: string; mimeType: string }): Promise<{ root: SnapshotNode; count: number }> {
  const visited = new Set<string>();
  let count = 0;
  const visit = async (file: drive_v3.Schema$File & { id: string; name: string; mimeType: string }, depth: number): Promise<SnapshotNode> => {
    if (depth > LIMITS.copyDepth) throw new SafeDriveError("COPY_DEPTH_LIMIT", 400, `コピー元は最大深度${LIMITS.copyDepth}までです。`);
    if (visited.has(file.id)) throw new SafeDriveError("COPY_CYCLE", 400, "コピー元に重複参照があるため中止しました。");
    visited.add(file.id);
    count++;
    if (count > LIMITS.copySourceNodes) throw new SafeDriveError("COPY_NODE_LIMIT", 400, `コピー元は${LIMITS.copySourceNodes}要素までです。`);
    if (file.mimeType !== FOLDER_MIME) {
      if (file.capabilities?.canCopy === false) throw new SafeDriveError("SOURCE_NOT_COPYABLE", 403, "コピーできないファイルが含まれています。");
      return { id: file.id, name: file.name, mimeType: file.mimeType, children: [] };
    }
    const children = await listAllChildren(drive, file.id);
    const snapshots: SnapshotNode[] = [];
    for (const child of children) snapshots.push(await visit(child, depth + 1));
    return { id: file.id, name: file.name, mimeType: file.mimeType, children: snapshots };
  };
  return { root: await visit(source, 0), count };
}

async function writeSnapshot(drive: drive_v3.Drive, node: SnapshotNode, destinationId: string, name: string): Promise<drive_v3.Schema$File> {
  if (node.mimeType !== FOLDER_MIME) {
    const response = await withDriveRetry(() => drive.files.copy({
      fileId: node.id,
      requestBody: { name, parents: [destinationId] },
      fields: "id,name,mimeType,webViewLink",
      supportsAllDrives: true,
    }));
    return response.data;
  }
  const folder = await withDriveRetry(() => drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [destinationId] },
    fields: "id,name,mimeType,webViewLink",
    supportsAllDrives: true,
  }));
  if (!folder.data.id) throw new SafeDriveError("INVALID_DRIVE_RESPONSE", 502, "Driveから不完全な応答が返されました。");
  for (const child of node.children) await writeSnapshot(drive, child, folder.data.id, child.name);
  return folder.data;
}

export async function copyItems(drive: drive_v3.Drive, sourceId: string, destinationId: string, names: string[]): Promise<{ results: ItemResult[]; summary: ResultSummary; authExpired: boolean }> {
  await assertNotDescendant(drive, sourceId, destinationId);
  await assertDestination(drive, destinationId);
  const source = await getFile(drive, sourceId);
  const snapshot = await snapshotSource(drive, source);
  if (snapshot.count * names.length > LIMITS.copyMutationsPerRequest) {
    throw new SafeDriveError("COPY_MUTATION_LIMIT", 400, `コピーで作成する要素は合計${LIMITS.copyMutationsPerRequest}件までです。`);
  }
  const collisions = await existingNames(drive, destinationId);
  const results: ItemResult[] = [];
  let authExpired = false;
  for (const [index, name] of names.entries()) {
    if (authExpired) {
      results.push({ key: String(index), name, status: "skipped", code: "AUTH_EXPIRED", message: "認証切れのため未実行です。" });
      continue;
    }
    if (collisions.has(name)) {
      results.push({ key: String(index), name, status: "skipped", code: "NAME_CONFLICT", message: "保存先に同名アイテムが存在するためスキップしました。" });
      continue;
    }
    try {
      const created = await writeSnapshot(drive, snapshot.root, destinationId, name);
      results.push({ key: String(index), name, status: "success", code: "COPIED", message: "コピーしました。", webViewLink: created.webViewLink ?? undefined });
    } catch (error: unknown) {
      const result = failure(name, index, error, snapshot.root.mimeType === FOLDER_MIME);
      results.push(result);
      authExpired = result.code === "AUTH_EXPIRED";
    }
  }
  return { results, summary: summarize(results), authExpired };
}

async function listAllPermissions(drive: drive_v3.Drive, targetId: string): Promise<drive_v3.Schema$Permission[]> {
  const permissions: drive_v3.Schema$Permission[] = [];
  let pageToken: string | undefined;
  do {
    const response = await withDriveRetry(() => drive.permissions.list({
      fileId: targetId,
      fields: "nextPageToken,permissions(id,type,emailAddress,role)",
      supportsAllDrives: true,
      pageSize: 100,
      pageToken,
    }));
    permissions.push(...(response.data.permissions ?? []));
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  return permissions;
}

export async function addPermissions(drive: drive_v3.Drive, items: Array<{ targetId: string; emails: string[] }>, role: "editor" | "viewer"): Promise<{ results: PermissionResult[]; summary: ResultSummary; authExpired: boolean }> {
  const desiredRole = role === "editor" ? "writer" : "reader";
  const results: PermissionResult[] = [];
  let authExpired = false;
  for (const item of items) {
    let existing: drive_v3.Schema$Permission[];
    try {
      existing = await listAllPermissions(drive, item.targetId);
    } catch (error: unknown) {
      const safe = safeDriveError(error);
      for (const email of item.emails) results.push({ targetId: item.targetId, email, status: "failed", code: safe.code, message: safe.message });
      if (safe.code === "AUTH_EXPIRED") { authExpired = true; break; }
      continue;
    }
    for (const email of item.emails) {
      if (authExpired) break;
      const permission = existing.find((candidate) => candidate.type === "user" && typeof candidate.emailAddress === "string" && normalizeEmail(candidate.emailAddress) === email);
      if (permission) {
        const sameRole = permission.role === desiredRole;
        const canUpgrade = desiredRole === "writer" && (permission.role === "reader" || permission.role === "commenter") && typeof permission.id === "string";
        if (canUpgrade) {
          try {
            await withDriveRetry(() => drive.permissions.update({
              fileId: item.targetId,
              permissionId: permission.id!,
              supportsAllDrives: true,
              requestBody: { role: "writer" },
            }));
            results.push({ targetId: item.targetId, email, status: "success", code: "PERMISSION_UPGRADED", message: "編集権限へ更新しました。" });
          } catch (error: unknown) {
            const safe = safeDriveError(error);
            results.push({ targetId: item.targetId, email, status: "failed", code: safe.code, message: safe.message });
            authExpired = safe.code === "AUTH_EXPIRED";
          }
          continue;
        }
        results.push({
          targetId: item.targetId,
          email,
          status: "skipped",
          code: sameRole ? "PERMISSION_EXISTS" : "PERMISSION_ROLE_UNCHANGED",
          message: sameRole ? "同じ権限が既にあるためスキップしました。" : "既存の権限を弱めないため変更しませんでした。",
        });
        continue;
      }
      try {
        await withDriveRetry(() => drive.permissions.create({
          fileId: item.targetId,
          sendNotificationEmail: false,
          supportsAllDrives: true,
          requestBody: { role: desiredRole, type: "user", emailAddress: email },
        }));
        results.push({ targetId: item.targetId, email, status: "success", code: "PERMISSION_CREATED", message: "権限を付与しました。" });
      } catch (error: unknown) {
        const safe = safeDriveError(error);
        results.push({ targetId: item.targetId, email, status: "failed", code: safe.code, message: safe.message });
        authExpired = safe.code === "AUTH_EXPIRED";
      }
    }
    if (authExpired) break;
  }
  if (authExpired) {
    const completed = new Set(results.map((result) => `${result.targetId}\0${result.email}`));
    for (const item of items) for (const email of item.emails) {
      if (!completed.has(`${item.targetId}\0${email}`)) results.push({ targetId: item.targetId, email, status: "skipped", code: "AUTH_EXPIRED", message: "認証切れのため未実行です。" });
    }
  }
  return { results, summary: summarize(results), authExpired };
}

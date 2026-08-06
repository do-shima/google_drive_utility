const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;
const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@([a-z0-9.-]+)$/i;

type DriveUrlInfo = { id: string; type: "folder" | "file" };

export function isDriveId(value: unknown): value is string {
  return typeof value === "string" && DRIVE_ID_PATTERN.test(value);
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isEmail(value: string): boolean {
  const match = value.match(EMAIL_PATTERN);
  return Boolean(match && isDomain(match[1]));
}

export function isDomain(value: string): boolean {
  return DOMAIN_PATTERN.test(value);
}

export function emailDomain(value: string): string | null {
  const normalized = normalizeEmail(value);
  if (!isEmail(normalized)) return null;
  return normalized.slice(normalized.lastIndexOf("@") + 1);
}

export function parseDriveUrl(value: string): DriveUrlInfo | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;

  const hostname = url.hostname.toLowerCase();
  let match: RegExpMatchArray | null = null;
  let type: DriveUrlInfo["type"] = "file";

  if (hostname === "drive.google.com") {
    match = url.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,200})(?:\/|$)/);
    if (match) type = "folder";
    else match = url.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/);
  } else if (hostname === "docs.google.com") {
    match = url.pathname.match(/^\/(?:document|spreadsheets|presentation|forms|drawings)\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{10,200})(?:\/|$)/);
  }

  return match ? { id: match[1], type } : null;
}

type TsvRow = { line: number; first: string; second: string };

export function parseTwoColumnTsv(value: string, firstLabel: string, secondLabel: string): { rows: TsvRow[]; errors: string[] } {
  const rows: TsvRow[] = [];
  const errors: string[] = [];
  value.split(/\r?\n/).forEach((raw, index) => {
    if (!raw.trim()) return;
    const columns = raw.split("\t");
    if (columns.length !== 2 || !columns[0].trim() || !columns[1].trim()) {
      errors.push(`${index + 1}行目: ${firstLabel}と${secondLabel}をタブ区切りで入力してください`);
      return;
    }
    rows.push({ line: index + 1, first: columns[0].trim(), second: columns[1].trim() });
  });
  return { rows, errors };
}

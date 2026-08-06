function safeCell(value: string): string {
  const protectedValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

export function createDriveCsv(rows: Array<{ mimeType: string; name: string; webViewLink: string }>): string {
  const header = ["種別", "名前", "URL"].map(safeCell).join(",");
  const body = rows.map((row) => [
    row.mimeType === "application/vnd.google-apps.folder" ? "フォルダ" : "ファイル",
    row.name,
    row.webViewLink,
  ].map(safeCell).join(","));
  return `\uFEFF${[header, ...body].join("\r\n")}`;
}

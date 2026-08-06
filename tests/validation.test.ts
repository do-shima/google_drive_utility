import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/contracts";
import { parseDriveUrl, parseTwoColumnTsv } from "@/lib/input";
import { validateDriveRequest } from "@/lib/validation";

const id = "abcdefghijk";

describe("request validation", () => {
  it("makes remove_permissions unavailable", () => {
    expect(validateDriveRequest({ action: "remove_permissions", targetIds: [id] }, "example.ac.jp")).toMatchObject({ ok: false, code: "INVALID_REQUEST" });
  });

  it("rejects external permission recipients and normalizes duplicates", () => {
    expect(validateDriveRequest({ action: "add_permissions_bulk", role: "viewer", items: [{ targetId: id, emails: ["user@outside.test"] }] }, "example.ac.jp")).toMatchObject({ ok: false });
    expect(validateDriveRequest({ action: "add_permissions_bulk", role: "viewer", items: [{ targetId: id, emails: ["USER@example.ac.jp", "user@example.ac.jp"] }] }, "example.ac.jp")).toMatchObject({ ok: true, value: { items: [{ emails: ["user@example.ac.jp"] }] } });
  });

  it("rejects duplicate names and request limits", () => {
    expect(validateDriveRequest({ action: "create_folders", destinationId: id, names: ["A", "A"] }, "example.ac.jp")).toMatchObject({ ok: false });
    expect(validateDriveRequest({ action: "create_folders", destinationId: id, names: Array.from({ length: LIMITS.namesPerRequest + 1 }, (_, index) => `n${index}`) }, "example.ac.jp")).toMatchObject({ ok: false, code: "LIMIT_EXCEEDED" });
  });
});

describe("client input", () => {
  it("accepts only supported Google Drive and Docs URL paths", () => {
    expect(parseDriveUrl(`https://drive.google.com/drive/folders/${id}`)).toEqual({ id, type: "folder" });
    expect(parseDriveUrl(`https://docs.google.com/spreadsheets/d/${id}/edit`)).toEqual({ id, type: "file" });
    expect(parseDriveUrl(`https://drive.google.com.attacker.test/drive/folders/${id}`)).toBeNull();
  });

  it("preserves spaces in TSV values and reports invalid line numbers", () => {
    expect(parseTwoColumnTsv("user@example.ac.jp\tGroup A", "email", "group").rows[0].second).toBe("Group A");
    expect(parseTwoColumnTsv("bad row", "email", "group").errors[0]).toContain("1行目");
  });
});

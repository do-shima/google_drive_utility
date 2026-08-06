import { describe, expect, it, vi } from "vitest";
import type { drive_v3 } from "googleapis";
import { LIMITS } from "@/lib/contracts";
import { addPermissions, copyItems, createFolders, listAllChildren } from "@/lib/drive";

function driveMock() {
  return {
    files: { list: vi.fn(), get: vi.fn(), create: vi.fn(), copy: vi.fn() },
    permissions: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
  };
}

function asDrive(mock: ReturnType<typeof driveMock>): drive_v3.Drive {
  return mock as unknown as drive_v3.Drive;
}

function file(id: string, name: string, mimeType = "text/plain", extra: drive_v3.Schema$File = {}) {
  return { id, name, mimeType, ...extra };
}

describe("Drive pagination and copy safety", () => {
  it("reads every files.list page", async () => {
    const mock = driveMock();
    mock.files.list
      .mockResolvedValueOnce({ data: { files: [file("file0000001", "A")], nextPageToken: "page-2" } })
      .mockResolvedValueOnce({ data: { files: [file("file0000002", "B")] } });
    await expect(listAllChildren(asDrive(mock), "parent00001")).resolves.toHaveLength(2);
    expect(mock.files.list).toHaveBeenNthCalledWith(2, expect.objectContaining({ pageToken: "page-2" }));
  });

  it("rejects source equal to destination without mutations", async () => {
    const mock = driveMock();
    await expect(copyItems(asDrive(mock), "same0000001", "same0000001", ["copy"])).rejects.toMatchObject({ code: "COPY_INTO_SELF" });
    expect(mock.files.create).not.toHaveBeenCalled();
    expect(mock.files.copy).not.toHaveBeenCalled();
  });

  it("rejects a destination below source without mutations", async () => {
    const mock = driveMock();
    mock.files.get.mockResolvedValue({ data: file("dest0000001", "dest", "application/vnd.google-apps.folder", { parents: ["source00001"] }) });
    await expect(copyItems(asDrive(mock), "source00001", "dest0000001", ["copy"])).rejects.toMatchObject({ code: "COPY_INTO_DESCENDANT" });
    expect(mock.files.create).not.toHaveBeenCalled();
    expect(mock.files.copy).not.toHaveBeenCalled();
  });

  it("finishes the snapshot before writing and never scans a newly created folder", async () => {
    const mock = driveMock();
    mock.files.get.mockImplementation(async ({ fileId }: { fileId: string }) => ({ data: file(fileId, fileId, "application/vnd.google-apps.folder", { parents: [], capabilities: { canAddChildren: true } }) }));
    mock.files.list.mockImplementation(async ({ q }: { q: string }) => {
      if (q.includes("source00001")) return { data: { files: [file("child000001", "child.txt")] } };
      if (q.includes("dest0000001")) return { data: { files: [] } };
      throw new Error("newly created folders must not be listed");
    });
    mock.files.create.mockResolvedValue({ data: file("created00001", "copy", "application/vnd.google-apps.folder", { webViewLink: "https://drive.google.com/x" }) });
    mock.files.copy.mockResolvedValue({ data: file("copied000001", "child.txt") });

    const outcome = await copyItems(asDrive(mock), "source00001", "dest0000001", ["copy"]);
    expect(outcome.summary).toEqual({ succeeded: 1, failed: 0, skipped: 0 });
    expect(mock.files.list).toHaveBeenCalledTimes(2);
    expect(Math.max(...mock.files.list.mock.invocationCallOrder)).toBeLessThan(mock.files.create.mock.invocationCallOrder[0]);
  });

  it("enforces depth, source-node and total-mutation limits before writing", async () => {
    const folderMime = "application/vnd.google-apps.folder";

    const deep = driveMock();
    deep.files.get.mockImplementation(async ({ fileId }: { fileId: string }) => ({ data: file(fileId, fileId, folderMime, { parents: [], capabilities: { canAddChildren: true } }) }));
    deep.files.list.mockImplementation(async ({ q }: { q: string }) => {
      const parent = q.match(/'([^']+)'/)?.[1] ?? "";
      if (parent === "dest0000001") return { data: { files: [] } };
      const depth = parent === "source00001" ? 0 : Number(parent.slice(1));
      return { data: { files: [file(`f${depth + 1}`, `level-${depth + 1}`, folderMime)] } };
    });
    await expect(copyItems(asDrive(deep), "source00001", "dest0000001", ["copy"])).rejects.toMatchObject({ code: "COPY_DEPTH_LIMIT" });
    expect(deep.files.create).not.toHaveBeenCalled();

    const wide = driveMock();
    wide.files.get.mockImplementation(async ({ fileId }: { fileId: string }) => ({ data: file(fileId, fileId, folderMime, { parents: [], capabilities: { canAddChildren: true } }) }));
    wide.files.list.mockImplementation(async ({ q }: { q: string }) => ({ data: { files: q.includes("source00001") ? Array.from({ length: LIMITS.copySourceNodes }, (_, index) => file(`child${index.toString().padStart(6, "0")}`, `child-${index}`)) : [] } }));
    await expect(copyItems(asDrive(wide), "source00001", "dest0000001", ["copy"])).rejects.toMatchObject({ code: "COPY_NODE_LIMIT" });
    expect(wide.files.create).not.toHaveBeenCalled();

    const mutations = driveMock();
    mutations.files.get.mockImplementation(async ({ fileId }: { fileId: string }) => ({ data: file(fileId, fileId, folderMime, { parents: [], capabilities: { canAddChildren: true } }) }));
    mutations.files.list.mockImplementation(async ({ q }: { q: string }) => ({ data: { files: q.includes("source00001") ? Array.from({ length: 10 }, (_, index) => file(`child0000${index}`, `child-${index}`)) : [] } }));
    await expect(copyItems(asDrive(mutations), "source00001", "dest0000001", Array.from({ length: 500 }, (_, index) => `copy-${index}`))).rejects.toMatchObject({ code: "COPY_MUTATION_LIMIT" });
    expect(mutations.files.create).not.toHaveBeenCalled();
  });
});

describe("structured batch results", () => {
  it("skips an existing identical permission", async () => {
    const mock = driveMock();
    mock.permissions.list.mockResolvedValue({ data: { permissions: [{ type: "user", emailAddress: "USER@example.ac.jp", role: "reader" }] } });
    const outcome = await addPermissions(asDrive(mock), [{ targetId: "target00001", emails: ["user@example.ac.jp"] }], "viewer");
    expect(outcome.results[0]).toMatchObject({ status: "skipped", code: "PERMISSION_EXISTS" });
    expect(mock.permissions.create).not.toHaveBeenCalled();
  });

  it("upgrades reader to writer but never downgrades writer to reader", async () => {
    const upgrade = driveMock();
    upgrade.permissions.list.mockResolvedValue({ data: { permissions: [{ id: "permission1", type: "user", emailAddress: "user@example.ac.jp", role: "reader" }] } });
    upgrade.permissions.update.mockResolvedValue({ data: {} });
    await expect(addPermissions(asDrive(upgrade), [{ targetId: "target00001", emails: ["user@example.ac.jp"] }], "editor")).resolves.toMatchObject({ results: [{ status: "success", code: "PERMISSION_UPGRADED" }] });

    const noDowngrade = driveMock();
    noDowngrade.permissions.list.mockResolvedValue({ data: { permissions: [{ id: "permission1", type: "user", emailAddress: "user@example.ac.jp", role: "writer" }] } });
    await expect(addPermissions(asDrive(noDowngrade), [{ targetId: "target00001", emails: ["user@example.ac.jp"] }], "viewer")).resolves.toMatchObject({ results: [{ status: "skipped", code: "PERMISSION_ROLE_UNCHANGED" }] });
    expect(noDowngrade.permissions.update).not.toHaveBeenCalled();
  });

  it("preserves successes when a later item fails", async () => {
    const mock = driveMock();
    mock.files.get.mockResolvedValue({ data: file("dest0000001", "dest", "application/vnd.google-apps.folder", { capabilities: { canAddChildren: true } }) });
    mock.files.list.mockResolvedValue({ data: { files: [] } });
    mock.files.create.mockResolvedValueOnce({ data: file("created00001", "A", "application/vnd.google-apps.folder") }).mockRejectedValueOnce({ response: { status: 403 } });
    const outcome = await createFolders(asDrive(mock), "dest0000001", ["A", "B"]);
    expect(outcome.results.map((result) => result.status)).toEqual(["success", "failed"]);
    expect(outcome.summary).toEqual({ succeeded: 1, failed: 1, skipped: 0 });
  });
});

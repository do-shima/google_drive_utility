import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]/route";
import { google } from "googleapis";

// 再帰的なフォルダコピーのためのヘルパー関数
async function copyFolderRecursive(drive: any, srcFolderId: string, dstFolderId: string, newFolderName: string): Promise<any> {
  // 1. コピー先に新しいフォルダを作成
  const folderRes = await drive.files.create({
    requestBody: { name: newFolderName, mimeType: "application/vnd.google-apps.folder", parents: [dstFolderId] },
    fields: "id, name, webViewLink",
    supportsAllDrives: true,
  });
  const newFolder = folderRes.data;

  // 2. コピー元のフォルダの中身を取得
  const contents = await drive.files.list({
    q: `'${srcFolderId}' in parents and trashed = false`,
    fields: "files(id, name, mimeType)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  // 3. 中身をループして複製（フォルダなら再帰呼び出し、ファイルなら単純コピー）
  for (const file of contents.data.files || []) {
    if (file.mimeType === "application/vnd.google-apps.folder") {
      await copyFolderRecursive(drive, file.id, newFolder.id, file.name);
    } else {
      await drive.files.copy({
        fileId: file.id,
        requestBody: { name: file.name, parents: [newFolder.id] },
        supportsAllDrives: true,
      });
    }
  }
  return newFolder;
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const accessToken = (session as any)?.accessToken;
  if (!session || !accessToken) return NextResponse.json({ error: "認証されていません" }, { status: 401 });

  const body = await request.json();
  const { action, targetId, srcId, srcType, names, emails, role, targetIds } = body;

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  const drive = google.drive({ version: "v3", auth: oauth2Client });

  try {
    switch (action) {
      case "get_links": {
        const response = await drive.files.list({
          q: `'${targetId}' in parents and trashed = false`,
          fields: "files(id, name, webViewLink, mimeType)",
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          pageSize: 1000,
        });
        return NextResponse.json({ files: response.data.files || [] });
      }

      case "create_folders": {
        const results = [];
        for (const name of names) {
          const res = await drive.files.create({
            requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [targetId] },
            fields: "id, name, webViewLink",
            supportsAllDrives: true,
          });
          results.push(res.data);
        }
        return NextResponse.json({ results });
      }

      case "copy_items": {
        const results = [];
        for (const name of names) {
          if (srcType === "folder") {
            const newFolder = await copyFolderRecursive(drive, srcId, targetId, name);
            results.push(newFolder);
          } else {
            const res = await drive.files.copy({
              fileId: srcId,
              requestBody: { name, parents: [targetId] },
              fields: "id, name, webViewLink",
              supportsAllDrives: true,
            });
            results.push(res.data);
          }
        }
        return NextResponse.json({ results });
      }

case "add_permissions_bulk": {
        const { items, role } = body;
        let count = 0;
        
        // items は [{ targetId: "xxx", emails: ["A@test", "B@test"] }, ...] の形式
        for (const item of items) {
          for (const email of item.emails) {
            await drive.permissions.create({
              fileId: item.targetId,
              sendNotificationEmail: false, // 通知メールは送らない
              supportsAllDrives: true,
              requestBody: { 
                role: role === "editor" ? "writer" : "reader", 
                type: "user", 
                emailAddress: email 
              },
            });
            count++;
          }
        }
        return NextResponse.json({ message: `${items.length}件のURLに対し、合計 ${count} 回の権限付与を実行しました。` });
      }

      // 権限削除アクション
      case "remove_permissions": {
        let count = 0;
        for (const id of targetIds) {
          const res = await drive.permissions.list({
            fileId: id,
            supportsAllDrives: true,
            fields: "permissions(id, role)",
          });
          for (const p of res.data.permissions || []) {
            if (p.role !== "owner") {
              await drive.permissions.delete({ fileId: id, permissionId: p.id!, supportsAllDrives: true });
              count++;
            }
          }
        }
        return NextResponse.json({ message: `オーナー以外の権限を合計 ${count} 件削除しました。` });
      }

      default:
        return NextResponse.json({ error: "無効なアクションです" }, { status: 400 });
    }
  } catch (error: any) {
    console.error("Drive API Error:", error.message);
    return NextResponse.json({ error: "APIの実行に失敗しました: " + error.message }, { status: 500 });
  }
}
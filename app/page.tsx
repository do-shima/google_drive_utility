"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { useMemo, useState } from "react";
import { createDriveCsv } from "@/lib/csv";
import type { DriveFileResult, ItemResult, PermissionResult, ResultSummary } from "@/lib/contracts";
import { isEmail, normalizeEmail, parseDriveUrl, parseTwoColumnTsv } from "@/lib/input";

type Message = { type: "" | "info" | "success" | "error"; text: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function apiError(value: unknown): { code: string; message: string; correlationId?: string } | null {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.code !== "string" || typeof value.error.message !== "string") return null;
  return { code: value.error.code, message: value.error.message, correlationId: typeof value.error.correlationId === "string" ? value.error.correlationId : undefined };
}

async function driveRequest(body: object): Promise<{ response: Response; data: unknown }> {
  const response = await fetch("/api/drive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let data: unknown = null;
  try { data = await response.json(); } catch { data = null; }
  return { response, data };
}

function ResultSummaryView({ summary }: { summary: ResultSummary }) {
  return <p className="text-sm font-semibold text-slate-700">成功 {summary.succeeded}件 / 失敗 {summary.failed}件 / スキップ {summary.skipped}件</p>;
}

function StatusMessage({ msg }: { msg: Message }) {
  if (!msg.text) return null;
  const styles = { info: "bg-indigo-50 text-indigo-700 border-indigo-100", success: "bg-emerald-50 text-emerald-800 border-emerald-100", error: "bg-rose-50 text-rose-800 border-rose-100" };
  return <div className={`mt-5 p-4 rounded-xl border text-sm font-medium whitespace-pre-line ${styles[msg.type || "info"]}`}>{msg.text}</div>;
}

export default function Home() {
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(false);
  const [authExpired, setAuthExpired] = useState(false);
  const [getLinksUrl, setGetLinksUrl] = useState("");
  const [files, setFiles] = useState<DriveFileResult[]>([]);
  const [getLinksMsg, setGetLinksMsg] = useState<Message>({ type: "", text: "" });
  const [taskMode, setTaskMode] = useState<"create" | "copy">("create");
  const [destinationUrl, setDestinationUrl] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [itemNames, setItemNames] = useState("");
  const [itemResults, setItemResults] = useState<ItemResult[]>([]);
  const [itemSummary, setItemSummary] = useState<ResultSummary | null>(null);
  const [copyMsg, setCopyMsg] = useState<Message>({ type: "", text: "" });
  const [memberTsv, setMemberTsv] = useState("");
  const [folderTsv, setFolderTsv] = useState("");
  const [permissionResults, setPermissionResults] = useState<PermissionResult[]>([]);
  const [permissionSummary, setPermissionSummary] = useState<ResultSummary | null>(null);
  const [permissionMsg, setPermissionMsg] = useState<Message>({ type: "", text: "" });

  const names = useMemo(() => itemNames.split(/\r?\n/).map((name) => name.trim()).filter(Boolean), [itemNames]);

  const markApiError = (data: unknown, fallback: string) => {
    const error = apiError(data);
    if (error?.code === "AUTH_EXPIRED" || error?.code === "AUTH_REQUIRED") setAuthExpired(true);
    return error ? `${error.message}${error.correlationId ? `\n照会ID: ${error.correlationId}` : ""}` : fallback;
  };

  const relogin = async () => {
    await signOut({ redirect: false });
    await signIn("google");
  };

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); alert("コピーしました"); }
    catch { alert("コピーに失敗しました"); }
  };

  const downloadCsv = () => {
    const url = URL.createObjectURL(new Blob([createDriveCsv(files)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "drive-urls.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleGetLinks = async () => {
    setFiles([]); setGetLinksMsg({ type: "", text: "" });
    const target = parseDriveUrl(getLinksUrl);
    if (!target || target.type !== "folder") return setGetLinksMsg({ type: "error", text: "drive.google.com の有効なフォルダURLを入力してください。" });
    setLoading(true);
    try {
      const { response, data } = await driveRequest({ action: "get_links", targetId: target.id });
      if (!response.ok || !isRecord(data) || !Array.isArray(data.files)) throw new Error(markApiError(data, "Drive URL一覧を取得できませんでした。"));
      const received = data.files.filter((file): file is DriveFileResult => isRecord(file) && typeof file.id === "string" && typeof file.name === "string" && typeof file.mimeType === "string" && typeof file.webViewLink === "string");
      setFiles(received);
      setGetLinksMsg({ type: "success", text: `${received.length}件のDrive URLを取得しました。` });
    } catch (error: unknown) {
      setGetLinksMsg({ type: "error", text: error instanceof Error ? error.message : "Drive URL一覧を取得できませんでした。" });
    } finally { setLoading(false); }
  };

  const handleCreateOrCopy = async () => {
    setItemResults([]); setItemSummary(null); setCopyMsg({ type: "", text: "" });
    const destination = parseDriveUrl(destinationUrl);
    if (!destination || destination.type !== "folder") return setCopyMsg({ type: "error", text: "保存先には有効なDriveフォルダURLを入力してください。" });
    if (names.length === 0) return setCopyMsg({ type: "error", text: "名前を1行につき1件入力してください。" });
    if (new Set(names).size !== names.length) return setCopyMsg({ type: "error", text: "入力内に重複する名前があります。" });
    const body: Record<string, unknown> = { action: taskMode === "create" ? "create_folders" : "copy_items", destinationId: destination.id, names };
    if (taskMode === "copy") {
      const source = parseDriveUrl(sourceUrl);
      if (!source) return setCopyMsg({ type: "error", text: "コピー元には有効なGoogle DriveまたはGoogle Docs系URLを入力してください。" });
      body.sourceId = source.id;
    }
    setLoading(true); setCopyMsg({ type: "info", text: "処理中です。Driveの変更は一括transactionではありません。" });
    try {
      const { response, data } = await driveRequest(body);
      if (isRecord(data) && Array.isArray(data.results)) setItemResults(data.results.filter((result): result is ItemResult => isRecord(result) && typeof result.key === "string" && typeof result.name === "string" && ["success", "failed", "skipped"].includes(String(result.status)) && typeof result.code === "string" && typeof result.message === "string"));
      if (isRecord(data) && isRecord(data.summary) && typeof data.summary.succeeded === "number" && typeof data.summary.failed === "number" && typeof data.summary.skipped === "number") setItemSummary(data.summary as ResultSummary);
      if (!response.ok) throw new Error(markApiError(data, "処理に失敗しました。"));
      setCopyMsg({ type: "success", text: "処理が完了しました。失敗・スキップ対象を確認してから再実行してください。" });
    } catch (error: unknown) {
      setCopyMsg({ type: "error", text: error instanceof Error ? error.message : "処理に失敗しました。" });
    } finally { setLoading(false); }
  };

  const permissionPayload = (role: "editor" | "viewer") => {
    const members = parseTwoColumnTsv(memberTsv, "メールアドレス", "グループ名");
    const folders = parseTwoColumnTsv(folderTsv, "グループ名", "対象URL");
    const errors = [...members.errors, ...folders.errors];
    const groupEmails = new Map<string, Set<string>>();
    for (const row of members.rows) {
      const email = normalizeEmail(row.first);
      if (!isEmail(email)) { errors.push(`${row.line}行目: メールアドレスの形式が不正です`); continue; }
      const emails = groupEmails.get(row.second) ?? new Set<string>();
      emails.add(email); groupEmails.set(row.second, emails);
    }
    const byTarget = new Map<string, Set<string>>();
    for (const row of folders.rows) {
      const target = parseDriveUrl(row.second);
      if (!target) { errors.push(`${row.line}行目: 対象URLが不正です`); continue; }
      const emails = groupEmails.get(row.first);
      if (!emails?.size) { errors.push(`${row.line}行目: グループ「${row.first}」に対応するメンバーがありません`); continue; }
      const combined = byTarget.get(target.id) ?? new Set<string>();
      emails.forEach((email) => combined.add(email)); byTarget.set(target.id, combined);
    }
    if (errors.length) return { errors, body: null };
    if (!byTarget.size) return { errors: ["有効な対応関係を1件以上入力してください。"], body: null };
    return { errors: [], body: { action: "add_permissions_bulk", role, items: [...byTarget].map(([targetId, emails]) => ({ targetId, emails: [...emails] })) } };
  };

  const handlePermissions = async (role: "editor" | "viewer") => {
    setPermissionResults([]); setPermissionSummary(null); setPermissionMsg({ type: "", text: "" });
    const payload = permissionPayload(role);
    if (!payload.body) return setPermissionMsg({ type: "error", text: payload.errors.join("\n") });
    setLoading(true); setPermissionMsg({ type: "info", text: "権限を順番に確認・付与しています。" });
    try {
      const { response, data } = await driveRequest(payload.body);
      if (isRecord(data) && Array.isArray(data.results)) setPermissionResults(data.results.filter((result): result is PermissionResult => isRecord(result) && typeof result.targetId === "string" && typeof result.email === "string" && ["success", "failed", "skipped"].includes(String(result.status)) && typeof result.code === "string" && typeof result.message === "string"));
      if (isRecord(data) && isRecord(data.summary) && typeof data.summary.succeeded === "number" && typeof data.summary.failed === "number" && typeof data.summary.skipped === "number") setPermissionSummary(data.summary as ResultSummary);
      if (!response.ok) throw new Error(markApiError(data, "権限付与に失敗しました。"));
      setPermissionMsg({ type: "success", text: "権限付与処理が完了しました。結果を確認してから再実行してください。" });
    } catch (error: unknown) {
      setPermissionMsg({ type: "error", text: error instanceof Error ? error.message : "権限付与に失敗しました。" });
    } finally { setLoading(false); }
  };

  if (status === "loading") return <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] text-slate-500 font-medium">読み込み中...</div>;
  if (!session) return <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] px-4"><div className="bg-white p-10 rounded-[2rem] shadow-sm border border-slate-100 max-w-md w-full text-center"><div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6 text-2xl">D</div><h1 className="text-2xl font-bold mb-2 text-slate-900">Drive Utility</h1><p className="text-slate-500 mb-8 text-sm">許可された大学Workspaceアカウントでログインしてください。</p><button onClick={() => signIn("google")} className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3.5 rounded-xl">Google で続ける</button></div></div>;

  return <div className="min-h-screen bg-[#FAFAFA] text-slate-800 pb-20">
    <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm"><div><h1 className="text-lg font-bold text-slate-900">Drive Utility</h1><p className="text-xs text-slate-500">{session.user?.email}</p></div><button onClick={() => signOut()} className="text-sm font-medium px-4 py-2 bg-white border border-slate-200 rounded-lg">ログアウト</button></header>
    <main className="max-w-5xl mx-auto px-4 mt-10 space-y-10">
      {authExpired && <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 flex flex-wrap items-center justify-between gap-3"><span>認証の有効期限が切れました。再度ログインしてください。</span><button onClick={relogin} className="bg-slate-900 text-white px-4 py-2 rounded-lg">再ログイン</button></div>}

      <section className="bg-white p-8 md:p-10 rounded-3xl shadow-sm border border-slate-100"><h2 className="text-xl font-bold text-slate-900">Drive URL一覧</h2><p className="text-sm text-slate-500 mt-1 mb-6">指定フォルダ直下のwebViewLinkを一覧化します。</p><div className="flex flex-col md:flex-row gap-4"><input value={getLinksUrl} onChange={(event) => setGetLinksUrl(event.target.value)} placeholder="https://drive.google.com/drive/folders/..." className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5"/><button onClick={handleGetLinks} disabled={loading} className="bg-indigo-600 text-white font-semibold px-8 py-3.5 rounded-xl disabled:opacity-50">一覧を取得</button></div><StatusMessage msg={getLinksMsg}/>
        {files.length > 0 && <div className="mt-8"><div className="flex justify-end gap-2 mb-4"><button onClick={downloadCsv} className="text-xs font-semibold border border-slate-200 px-4 py-2 rounded-lg">CSV出力</button><button onClick={() => copyToClipboard(files.map((file) => `${file.name}\t${file.webViewLink}`).join("\n"))} className="text-xs font-semibold bg-indigo-50 text-indigo-700 px-4 py-2 rounded-lg">全件コピー</button></div><div className="border border-slate-200 rounded-2xl overflow-x-auto"><table className="w-full text-sm min-w-[600px]"><thead className="bg-slate-50"><tr><th className="p-4 text-left">種別</th><th className="p-4 text-left">名前</th><th className="p-4 text-left">URL</th></tr></thead><tbody>{files.map((file) => <tr key={file.id} className="border-t border-slate-100"><td className="p-4">{file.mimeType === "application/vnd.google-apps.folder" ? "フォルダ" : "ファイル"}</td><td className="p-4">{file.name}</td><td className="p-4 break-all"><a href={file.webViewLink} target="_blank" rel="noopener noreferrer" className="text-indigo-600">{file.webViewLink || "URLなし"}</a></td></tr>)}</tbody></table></div></div>}
      </section>

      <section className="bg-white p-8 md:p-10 rounded-3xl shadow-sm border border-slate-100"><div className="flex p-1 bg-slate-100 rounded-xl w-fit mb-8"><button onClick={() => setTaskMode("create")} className={`px-6 py-2.5 rounded-lg text-sm font-semibold ${taskMode === "create" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"}`}>新規フォルダ作成</button><button onClick={() => setTaskMode("copy")} className={`px-6 py-2.5 rounded-lg text-sm font-semibold ${taskMode === "copy" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"}`}>既存アイテム複製</button></div><div className="space-y-6"><label className="block text-sm font-bold">保存先フォルダURL<input value={destinationUrl} onChange={(event) => setDestinationUrl(event.target.value)} className="mt-2 w-full bg-slate-50 border border-slate-200 rounded-xl px-5 py-3.5 font-normal"/></label>{taskMode === "copy" && <label className="block text-sm font-bold bg-indigo-50/50 p-5 rounded-2xl">コピー元URL<input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} className="mt-2 w-full bg-white border border-indigo-200 rounded-xl px-5 py-3.5 font-normal"/></label>}<label className="block text-sm font-bold">作成する名前（1行1件）<textarea value={itemNames} onChange={(event) => setItemNames(event.target.value)} className="mt-2 w-full h-32 bg-slate-50 border border-slate-200 rounded-xl px-5 py-4 font-normal"/></label></div><button onClick={handleCreateOrCopy} disabled={loading} className="mt-8 bg-slate-900 text-white font-semibold px-8 py-3.5 rounded-xl disabled:opacity-50">{taskMode === "create" ? "フォルダを一括作成" : "アイテムを一括複製"}</button><StatusMessage msg={copyMsg}/>{itemSummary && <div className="mt-6"><ResultSummaryView summary={itemSummary}/><p className="text-xs text-amber-700 mt-1">再実行前に成功済み・部分作成済みの対象を確認してください。</p><ul className="mt-3 space-y-2">{itemResults.map((result) => <li key={result.key} className="text-sm border border-slate-100 rounded-lg p-3"><span className="font-semibold">[{result.status}] {result.name}</span> — {result.message}{result.webViewLink && <> <a href={result.webViewLink} target="_blank" rel="noopener noreferrer" className="text-indigo-600">開く</a></>}</li>)}</ul></div>}
      </section>

      <section className="bg-white p-8 md:p-10 rounded-3xl shadow-sm border border-slate-100"><h2 className="text-xl font-bold text-slate-900">アクセス権限の一括付与</h2><p className="text-sm text-slate-500 mt-1 mb-6">Excel / Google Sheetsから2列のTSVを貼り付けます。CSVや空白区切りには対応しません。</p><div className="grid md:grid-cols-2 gap-6"><label className="text-sm font-bold">① メールアドレス［Tab］グループ名<textarea value={memberTsv} onChange={(event) => setMemberTsv(event.target.value)} placeholder={'user@example.ac.jp\tゼミ A'} className="mt-2 w-full h-48 bg-slate-50 border border-slate-200 rounded-xl px-5 py-4 font-mono font-normal"/></label><label className="text-sm font-bold">② グループ名［Tab］対象URL<textarea value={folderTsv} onChange={(event) => setFolderTsv(event.target.value)} placeholder={'ゼミ A\thttps://drive.google.com/drive/folders/...'} className="mt-2 w-full h-48 bg-slate-50 border border-slate-200 rounded-xl px-5 py-4 font-mono font-normal"/></label></div><div className="flex gap-3 mt-8"><button onClick={() => handlePermissions("editor")} disabled={loading} className="flex-1 bg-indigo-600 text-white font-semibold py-3 rounded-xl disabled:opacity-50">編集権限を付与</button><button onClick={() => handlePermissions("viewer")} disabled={loading} className="flex-1 border border-slate-200 font-semibold py-3 rounded-xl disabled:opacity-50">閲覧権限を付与</button></div><StatusMessage msg={permissionMsg}/>{permissionSummary && <div className="mt-6"><ResultSummaryView summary={permissionSummary}/><p className="text-xs text-amber-700 mt-1">Driveの変更はtransactionではありません。失敗対象だけを確認して再実行してください。</p><ul className="mt-3 space-y-2">{permissionResults.map((result) => <li key={`${result.targetId}-${result.email}`} className="text-sm border border-slate-100 rounded-lg p-3"><span className="font-semibold">[{result.status}] {result.email}</span> — {result.message}</li>)}</ul></div>}
      </section>
    </main>
  </div>;
}

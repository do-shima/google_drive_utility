"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { useState, useMemo } from "react";

// ==========================================
// ヘルパー関数
// ==========================================
function extractInfoFromUrl(url: string) {
  if (typeof url !== "string") return null;
  const folderRegex = /\/folders\/([a-zA-Z0-9_-]+)/;
  const fileRegex = /\/d\/([a-zA-Z0-9_-]+)/;
  let match = url.match(folderRegex);
  if (match) return { id: match[1], type: "folder" };
  match = url.match(fileRegex);
  if (match) return { id: match[1], type: "file" };
  return null;
}

function parseRow(row: string) {
  if (row.includes('\t')) return row.split('\t').map(c => c.trim()).filter(c => c);
  if (row.includes(',')) return row.split(',').map(c => c.trim()).filter(c => c);
  return row.split(/[ \u3000]+/).map(c => c.trim()).filter(c => c);
}

// ==========================================
// メインコンポーネント
// ==========================================
export default function Home() {
  const { data: session, status } = useSession();

  const [loading, setLoading] = useState(false);
  
  // 1. リンク取得用
  const [getLinksUrl, setGetLinksUrl] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [getLinksMsg, setGetLinksMsg] = useState({ type: "", text: "" });

  // 2. 作成・複製用
  const [taskMode, setTaskMode] = useState<"create" | "copy">("create");
  const [dstUrl, setDstUrl] = useState("");
  const [srcUrl, setSrcUrl] = useState("");
  const [itemNames, setItemNames] = useState("");
  const [copyResults, setCopyResults] = useState<any[]>([]);
  const [copyMsg, setCopyMsg] = useState({ type: "", text: "" });

  // 3. 権限管理用
  const [authGroupMembers, setAuthGroupMembers] = useState("");
  const [authGroupUrls, setAuthGroupUrls] = useState("");
  const [authMsg, setAuthMsg] = useState({ type: "", text: "" });

  const validItemNamesCount = useMemo(() => itemNames.split('\n').filter(n => n.trim()).length, [itemNames]);

  if (status === "loading") return <div className="min-h-screen flex items-center justify-center text-gray-500">システムを準備中...</div>;

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <div className="bg-white p-10 rounded-xl shadow-sm border border-gray-200 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold mb-2 text-gray-900">Drive Utility Web</h1>
          <p className="text-gray-500 mb-8 text-sm">社内アカウントでログインしてツールを利用します</p>
          <button onClick={() => signIn("google")} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors">Google でログイン</button>
        </div>
      </div>
    );
  }

  const copyToClipboard = async (text: string, successMsg: string = "コピーしました") => {
    try {
      await navigator.clipboard.writeText(text);
      alert(successMsg);
    } catch (err) {
      alert("コピーに失敗しました");
    }
  };

  const downloadCSV = (data: any[], filename: string) => {
    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" 
      + "種別,名前,URL\n" 
      + data.map(row => `${row.mimeType === "application/vnd.google-apps.folder" ? "フォルダ" : "ファイル"},"${row.name}","${row.webViewLink}"`).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 1. リンク取得処理
  const handleGetLinks = async () => {
    setGetLinksMsg({ type: "", text: "" }); setResults([]);
    const info = extractInfoFromUrl(getLinksUrl);
    if (!info || info.type !== "folder") return setGetLinksMsg({ type: "error", text: "有効なフォルダURLを入力してください" });
    
    setLoading(true); setGetLinksMsg({ type: "info", text: "フォルダ情報を取得中..." });
    try {
      const res = await fetch("/api/drive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "get_links", targetId: info.id }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResults(data.files); 
      setGetLinksMsg({ type: "success", text: `${data.files.length}件のアイテムを取得しました` });
    } catch (err: any) { setGetLinksMsg({ type: "error", text: `取得失敗: ${err.message}` }); } finally { setLoading(false); }
  };

  // 2. 作成・複製処理
  const handleCreateOrCopy = async () => {
    setCopyMsg({ type: "", text: "" }); setCopyResults([]);
    const dstInfo = extractInfoFromUrl(dstUrl);
    const names = itemNames.split('\n').map(n => n.trim()).filter(n => n);
    
    if (!dstInfo || dstInfo.type !== "folder") return setCopyMsg({ type: "error", text: "保存先の有効なフォルダURLを入力してください" });
    if (names.length === 0) return setCopyMsg({ type: "error", text: "作成するファイル名を1件以上入力してください" });
    
    let payload: any = { action: taskMode === "create" ? "create_folders" : "copy_items", targetId: dstInfo.id, names };
    
    if (taskMode === "copy") {
      const srcInfo = extractInfoFromUrl(srcUrl);
      if (!srcInfo) return setCopyMsg({ type: "error", text: "コピー元の有効なURLを入力してください" });
      payload.srcId = srcInfo.id;
      payload.srcType = srcInfo.type;
    }

    setLoading(true); setCopyMsg({ type: "info", text: "処理を実行中...（件数が多い場合は数分かかります）" });
    try {
      const res = await fetch("/api/drive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCopyResults(data.results); 
      setCopyMsg({ type: "success", text: `${data.results.length}件のアイテムを生成しました` });
      setItemNames("");
    } catch (err: any) { setCopyMsg({ type: "error", text: `処理失敗: ${err.message}` }); } finally { setLoading(false); }
  };

  // 3. 権限管理処理
  const handleManageAuthBulk = async (actionType: "add" | "remove", role?: "editor" | "viewer") => {
    setAuthMsg({ type: "", text: "" });
    const memberRows = authGroupMembers.split('\n').map(r => r.trim()).filter(r => r);
    const urlRows = authGroupUrls.split('\n').map(r => r.trim()).filter(r => r);

    let payload: any = {};

    if (actionType === "remove") {
      if (urlRows.length === 0) return setAuthMsg({ type: "error", text: "グループとURLの対照表を入力してください" });
      const urls = urlRows.map(r => {
        const cols = parseRow(r);
        return extractInfoFromUrl(cols[1] || cols[0]);
      }).filter(u => u !== null);
      
      if (urls.length === 0) return setAuthMsg({ type: "error", text: "削除対象の有効なURLが見つかりません" });
      if (!confirm(`抽出された ${urls.length} 件のアイテムから、オーナー以外の権限をすべて削除します。\n本当によろしいですか？`)) return;
      payload = { action: "remove_permissions", targetIds: urls.map(u => u?.id) };
      
    } else {
      if (memberRows.length === 0 || urlRows.length === 0) return setAuthMsg({ type: "error", text: "両方の対照表を入力してください" });

      const groupMap: Record<string, string[]> = {};
      memberRows.forEach(row => {
        const cols = parseRow(row);
        if (cols.length >= 2) {
          if (!groupMap[cols[1]]) groupMap[cols[1]] = [];
          groupMap[cols[1]].push(cols[0]);
        }
      });

      const items: { targetId: string, emails: string[] }[] = [];
      urlRows.forEach(row => {
        const cols = parseRow(row);
        if (cols.length >= 2) {
          const urlInfo = extractInfoFromUrl(cols[1]);
          const emails = groupMap[cols[0]];
          if (urlInfo && emails && emails.length > 0) items.push({ targetId: urlInfo.id, emails });
        }
      });

      if (items.length === 0) return setAuthMsg({ type: "error", text: "グループ名が一致する有効な組み合わせが見つかりません" });
      payload = { action: "add_permissions_bulk", items, role };
    }

    setLoading(true); setAuthMsg({ type: "info", text: "権限の一括処理を実行中..." });
    try {
      const res = await fetch("/api/drive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAuthMsg({ type: "success", text: data.message });
    } catch (err: any) { setAuthMsg({ type: "error", text: `処理失敗: ${err.message}` }); } finally { setLoading(false); }
  };

  const StatusMessage = ({ msg }: { msg: { type: string, text: string } }) => {
    if (!msg.text) return null;
    const styles = {
      info: "bg-blue-50 text-blue-700 border-blue-200",
      success: "bg-green-50 text-green-700 border-green-200",
      error: "bg-red-50 text-red-700 border-red-200",
    };
    return (
      <div className={`mt-4 p-3 rounded-lg border text-sm font-medium ${styles[msg.type as keyof typeof styles]}`}>
        {msg.type === "info" && "⏳ "}
        {msg.type === "success" && "✅ "}
        {msg.type === "error" && "⚠️ "}
        {msg.text}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#f3f4f6] p-4 md:p-8 font-sans text-gray-900">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="flex justify-between items-center bg-white p-5 rounded-xl shadow-sm border border-gray-200">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">Drive Utility Web</h1>
            <p className="text-sm text-gray-500 mt-1">{session.user?.email}</p>
          </div>
          <button onClick={() => signOut()} className="text-sm font-medium text-gray-700 hover:text-gray-900 px-4 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200">
            ログアウト
          </button>
        </header>

        {/* 1. 共有リンク取得セクション */}
        <section className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-gray-200">
          <h2 className="text-lg font-bold mb-1 text-gray-900">共有リンクを一覧化</h2>
          <p className="text-sm text-gray-500 mb-5">指定したフォルダ内のアイテムを一覧取得し、リンクをリスト化します。</p>
          
          <div className="flex flex-col md:flex-row gap-3">
            <input 
              type="text" value={getLinksUrl} onChange={(e) => setGetLinksUrl(e.target.value)} 
              placeholder="対象フォルダのURLを貼り付け" 
              className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-gray-900 bg-white focus:ring-2 focus:ring-blue-500 outline-none" 
            />
            <button onClick={handleGetLinks} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2 rounded-lg transition-colors disabled:opacity-50">
              一覧を取得する
            </button>
          </div>
          <StatusMessage msg={getLinksMsg} />

          {results.length > 0 && (
            <div className="mt-6">
              <div className="flex justify-end gap-2 mb-3">
                <button onClick={() => downloadCSV(results, 'links.csv')} className="text-xs font-medium bg-white border border-gray-300 text-gray-700 px-3 py-2 rounded hover:bg-gray-50 transition-colors">
                  CSV出力
                </button>
                {/* ボタンの強調と機能の明示 */}
                <button 
                  onClick={() => copyToClipboard(results.map(r => `${r.name}\t${r.webViewLink}`).join('\n'), '一覧をコピーしました。\n下部の「権限管理」の入力欄にそのまま貼り付けできます。')} 
                  className="text-xs font-bold bg-blue-50 border border-blue-200 text-blue-700 px-3 py-2 rounded hover:bg-blue-100 transition-colors flex items-center gap-1"
                >
                  📋 全件コピー (権限管理に貼付可)
                </button>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-x-auto">
                <table className="w-full text-left text-sm min-w-[600px]">
                  <thead className="bg-gray-50 border-b border-gray-200 text-gray-700">
                    <tr>
                      <th className="px-4 py-3 font-medium w-16 text-center">種別</th>
                      <th className="px-4 py-3 font-medium w-1/4">名前</th>
                      <th className="px-4 py-3 font-medium w-1/2">URL</th>
                      <th className="px-4 py-3 font-medium text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {results.map((f) => (
                      <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-center text-lg">{f.mimeType === "application/vnd.google-apps.folder" ? "📁" : "📄"}</td>
                        <td className="px-4 py-3 font-medium text-gray-800">{f.name}</td>
                        {/* URLをそのまま表示 */}
                        <td className="px-4 py-3 font-mono text-xs text-gray-600 break-all select-all">{f.webViewLink}</td>
                        <td className="px-4 py-3 text-center">
                          <a href={f.webViewLink} target="_blank" rel="noopener noreferrer" className="text-xs bg-white border border-gray-300 text-gray-700 hover:bg-gray-100 px-3 py-1.5 rounded font-medium transition-colors inline-block">
                            開く ↗
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        {/* 2. アイテム作成・複製セクション */}
        <section className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-gray-200">
          <div className="flex items-center justify-between mb-6 border-b border-gray-200">
            <div className="flex gap-6">
              <button onClick={() => setTaskMode("create")} className={`pb-3 text-sm font-bold transition-colors ${taskMode === "create" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700"}`}>新規フォルダの作成</button>
              <button onClick={() => setTaskMode("copy")} className={`pb-3 text-sm font-bold transition-colors ${taskMode === "copy" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700"}`}>既存アイテムの複製</button>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">保存先フォルダ</label>
              <p className="text-xs text-gray-500 mb-2">アイテムを作成・保存する親フォルダのURLを入力します</p>
              <input type="text" value={dstUrl} onChange={(e) => setDstUrl(e.target.value)} placeholder="https://drive.google.com/drive/folders/..." className="w-full border border-gray-300 rounded-lg px-4 py-2 bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>

            {taskMode === "copy" && (
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                <label className="block text-sm font-bold text-blue-900 mb-1">コピー元アイテム</label>
                <p className="text-xs text-blue-700 mb-2">テンプレートとして複製したいファイルまたはフォルダのURL</p>
                <input type="text" value={srcUrl} onChange={(e) => setSrcUrl(e.target.value)} placeholder="https://drive.google.com/..." className="w-full border border-blue-200 rounded-lg px-4 py-2 bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
            )}

            <div>
              <div className="flex justify-between items-end mb-2">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">ファイル名 / フォルダ名</label>
                  <p className="text-xs text-gray-500">1行につき1つのアイテムが作成されます</p>
                </div>
                {validItemNamesCount > 0 && <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100">実行プレビュー: {validItemNamesCount}件を作成</span>}
              </div>
              <textarea value={itemNames} onChange={(e) => setItemNames(e.target.value)} placeholder="プロジェクトA&#13;&#10;プロジェクトB&#13;&#10;プロジェクトC" className="w-full border border-gray-300 rounded-lg px-4 py-3 h-32 bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none resize-y" />
            </div>
          </div>

          <div className="mt-6">
            <button onClick={handleCreateOrCopy} disabled={loading || validItemNamesCount === 0} className="w-full md:w-auto bg-blue-600 hover:bg-blue-700 text-white font-medium px-8 py-3 rounded-lg transition-colors disabled:opacity-50">
              {taskMode === "create" ? "フォルダを一括作成する" : "アイテムを一括複製する"}
            </button>
          </div>
          <StatusMessage msg={copyMsg} />

          {copyResults.length > 0 && (
            <div className="mt-6 border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex justify-between items-center">
                <span className="text-xs font-bold text-gray-700">作成結果 ({copyResults.length}件)</span>
                <button onClick={() => copyToClipboard(copyResults.map(r => `${r.name}\t${r.webViewLink}`).join('\n'))} className="text-xs text-blue-600 hover:underline">一覧をコピー</button>
              </div>
              <ul className="divide-y divide-gray-100 max-h-60 overflow-y-auto">
                {copyResults.map((f, i) => (
                  <li key={i} className="px-4 py-3 flex justify-between items-center hover:bg-gray-50">
                    <span className="font-medium text-sm text-gray-800">{f.name}</span>
                    <a href={f.webViewLink} target="_blank" rel="noopener noreferrer" className="text-xs bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 px-3 py-1 rounded font-medium transition-colors">開く ↗</a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* 3. 権限管理セクション */}
        <section className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-gray-200">
          <h2 className="text-lg font-bold mb-1 text-gray-900">アクセス権限の一括管理</h2>
          {/* 説明文に連携のヒントを記載 */}
          <p className="text-sm text-gray-600 mb-6 bg-yellow-50 p-3 rounded border border-yellow-200">
            💡 エクセル等で作成した対照表、または<strong>上部の「共有リンク取得」から全件コピーしたリスト</strong>をそのまま貼り付けて権限を一括処理できます。
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <label className="block text-sm font-bold text-gray-700 mb-1">① メンバー割当表</label>
              <p className="text-xs text-gray-500 mb-3">メールアドレスと所属グループ名</p>
              <textarea 
                value={authGroupMembers} onChange={(e) => setAuthGroupMembers(e.target.value)} 
                placeholder={`[メールアドレス]   [グループ名]\n\nuser1@test.com   グループA\nuser2@test.com   グループA`} 
                className="w-full border border-gray-300 rounded-lg px-3 py-2 h-40 font-mono text-sm bg-white text-gray-900 outline-none focus:ring-2 focus:ring-blue-500" 
              />
            </div>
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <label className="block text-sm font-bold text-gray-700 mb-1">② フォルダ割当表</label>
              <p className="text-xs text-gray-500 mb-3">グループ名と対象のURL（※権限削除時はURLのみで可）</p>
              <textarea 
                value={authGroupUrls} onChange={(e) => setAuthGroupUrls(e.target.value)} 
                placeholder={`[グループ名]   [フォルダURL]\n\nグループA    https://drive...`} 
                className="w-full border border-gray-300 rounded-lg px-3 py-2 h-40 font-mono text-sm bg-white text-gray-900 outline-none focus:ring-2 focus:ring-blue-500" 
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button onClick={() => handleManageAuthBulk("add", "editor")} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50">編集権限を一括付与</button>
            <button onClick={() => handleManageAuthBulk("add", "viewer")} disabled={loading} className="bg-blue-100 hover:bg-blue-200 text-blue-800 font-medium px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50">閲覧権限を一括付与</button>
            <div className="w-full md:w-auto flex-1 text-right">
              <button onClick={() => handleManageAuthBulk("remove")} disabled={loading} className="bg-white border border-red-300 text-red-600 hover:bg-red-50 font-medium px-5 py-2.5 rounded-lg transition-colors disabled:opacity-50">権限をすべて削除（リセット）</button>
            </div>
          </div>
          <StatusMessage msg={authMsg} />
        </section>
      </div>
    </div>
  );
}
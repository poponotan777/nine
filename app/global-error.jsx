"use client";

// レイアウト自体が壊れた場合の最終防衛ライン
export default function GlobalError({ error, reset }) {
  return (
    <html lang="ja">
      <body style={{ margin: 0, background: "#F0F6F4", fontFamily: "sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 16, padding: 24, maxWidth: 480, width: "100%" }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: "#16324F", margin: "0 0 10px" }}>⚠ エラーが発生しました</h2>
            <pre style={{ background: "#FDF2F2", borderRadius: 8, padding: 10, fontSize: 11, color: "#8F1D1D", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 180, overflowY: "auto" }}>
              {String(error?.message || error || "不明なエラー")}
              {error?.digest ? `\ndigest: ${error.digest}` : ""}
            </pre>
            <button onClick={() => reset()} style={{ width: "100%", marginTop: 14, background: "#10B981", color: "#fff", border: "none", borderRadius: 10, padding: "12px 0", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
              再読み込み
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}

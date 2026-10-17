"use client";

// アプリ内でエラーが起きたとき、白画面ではなく内容を表示して復帰できるようにする
export default function Error({ error, reset }) {
  return (
    <div style={{
      minHeight: "100vh", background: "#F0F6F4", display: "flex",
      alignItems: "center", justifyContent: "center", padding: 20,
      fontFamily: "'Hiragino Sans','Noto Sans JP',sans-serif",
    }}>
      <div style={{ background: "#fff", border: "1px solid #DDE9E4", borderRadius: 16, padding: 24, maxWidth: 480, width: "100%" }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: "#16324F", margin: "0 0 10px" }}>⚠ エラーが発生しました</h2>
        <p style={{ fontSize: 12.5, color: "#64748B", lineHeight: 1.7, marginBottom: 12 }}>
          お手数ですが下のボタンで再読み込みしてください。
          繰り返し発生する場合は、以下のエラー内容を開発者に伝えてください。
        </p>
        <pre style={{
          background: "#FDF2F2", border: "1px solid #F0B4B4", borderRadius: 8,
          padding: 10, fontSize: 11, color: "#8F1D1D", whiteSpace: "pre-wrap",
          wordBreak: "break-all", maxHeight: 180, overflowY: "auto",
        }}>
          {String(error?.message || error || "不明なエラー")}
          {error?.digest ? `\ndigest: ${error.digest}` : ""}
        </pre>
        <button
          onClick={() => reset()}
          style={{ width: "100%", marginTop: 14, background: "#10B981", color: "#fff", border: "none", borderRadius: 10, padding: "12px 0", fontSize: 14, fontWeight: 800, cursor: "pointer" }}
        >
          再読み込み
        </button>
      </div>
    </div>
  );
}

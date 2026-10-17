export default function NotFound() {
  return (
    <div style={{ minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Hiragino Sans','Noto Sans JP',sans-serif", color: "#16324F", padding: 24, textAlign: "center" }}>
      <div style={{ fontSize: 40 }}>🔍</div>
      <h1 style={{ fontSize: 18, margin: "10px 0" }}>ページが見つかりませんでした</h1>
      <p style={{ fontSize: 13, color: "#64748B", lineHeight: 1.7 }}>取り扱いが終わった商品か、URLが間違っている可能性があります。</p>
      <a href="/" style={{ marginTop: 14, background: "#16324F", color: "#fff", borderRadius: 10, padding: "11px 22px", textDecoration: "none", fontWeight: 800, fontSize: 14 }}>オウダンで探す</a>
    </div>
  );
}

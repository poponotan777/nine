export const metadata = {
  metadataBase: new URL(process.env.SITE_ORIGIN || "https://oudan.vercel.app"),
  title: "オウダン | 楽天・Yahoo!・Amazon 横断 最安値比較",
  description:
    "楽天市場・Yahoo!ショッピング・Amazonの価格を、ポイント込みの実質価格で比較。90日の中央値との差や「3か月で何番目に安いか」で買い時がわかります。",
};

const responsiveCss = `
  .oud-wrap { max-width: 560px; margin: 0 auto; }
  .oud-grid { display: grid; grid-template-columns: 1fr; gap: 10px; align-items: start; align-content: start; }
  .oud-grid4 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: start; }
  .oud-grid > * { align-self: start; }
  @media (min-width: 900px) {
    .oud-wrap { max-width: 1120px; }
    .oud-grid { grid-template-columns: 1fr 1fr; gap: 14px; }
    .oud-grid4 { grid-template-columns: repeat(4, 1fr); gap: 14px; }
    .oud-search input { font-size: 17px !important; padding: 15px 18px !important; }
    .oud-search button { padding: 0 30px !important; font-size: 15px !important; }
  }
`;

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body style={{ margin: 0 }}>
        <style dangerouslySetInnerHTML={{ __html: responsiveCss }} />
        {children}
      </body>
    </html>
  );
}

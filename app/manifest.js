export default function manifest() {
  return {
    name: "オウダン - 実質価格で比べる横断検索",
    short_name: "オウダン",
    description: "楽天・Yahoo!・Amazonの実質最安値を横断比較。価格推移と買い時がわかる。",
    start_url: "/",
    display: "standalone",
    background_color: "#F4F1EB",
    theme_color: "#1E1A12",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}

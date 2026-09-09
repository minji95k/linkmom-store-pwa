import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "링크맘 매장 운영",
    short_name: "링크맘",
    description: "링크맘 매장 직원용 프로모션·공지·교육자료 운영 포털",
    start_url: "/",
    display: "standalone",
    background_color: "#faf8fc",
    theme_color: "#b673ca",
    orientation: "portrait-primary",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

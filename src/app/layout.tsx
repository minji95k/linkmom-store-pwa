import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";

import { RegisterServiceWorker } from "./register-sw";

import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  variable: "--font-noto-sans-kr",
  display: "swap",
});

export const metadata: Metadata = {
  title: "링크맘 매장 운영",
  description: "링크맘 매장 직원용 프로모션·공지·교육자료 운영 포털",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "링크맘",
  },
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#b673ca",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={notoSansKr.variable}>
      <body className="font-sans antialiased">
        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}

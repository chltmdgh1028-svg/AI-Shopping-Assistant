import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const titleFont = localFont({
  src: "./fonts/DongeulHand-Regular.ttf",
  variable: "--font-title",
  display: "swap",
});

const bodyFont = localFont({
  src: "./fonts/Seungho-Work-Regular.ttf",
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Shopping Assistant",
  description: "AI clothing purchase assistant MVP",
};

export const viewport: Viewport = {
  themeColor: "#f7f4ef",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${titleFont.variable} ${bodyFont.variable}`}>
        {children}
      </body>
    </html>
  );
}

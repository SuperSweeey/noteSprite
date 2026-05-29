import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Noteflow",
  description: "个人 AI 知识管理系统",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

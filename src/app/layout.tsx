import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NoteSprite",
  description: "有精灵的真实笔记~",
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

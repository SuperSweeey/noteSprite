import type { Metadata } from "next";
import "./globals.css";
import { getCurrentUserId } from "@/lib/auth";
import { resolveSettings } from "@/lib/ai-config";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "NoteSprite",
  description: "懂你的真实笔记",
};

export const dynamic = "force-dynamic";

function cssFontStack(fontName: string) {
  const cleaned = fontName.replace(/["';{}]/g, "").trim();
  return cleaned ? `"${cleaned}", var(--font-sans)` : "var(--font-sans)";
}

async function getAppearance() {
  try {
    const userId = await getCurrentUserId();
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } });
    return resolveSettings(user?.settings).appearance;
  } catch {
    return { fontFamily: "source-serif", customFontFamily: "" };
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const appearance = await getAppearance();
  return (
    <html lang="zh-CN">
      <body data-font={appearance.fontFamily} style={{ "--custom-font": cssFontStack(appearance.customFontFamily || "") } as React.CSSProperties}>
        {children}
      </body>
    </html>
  );
}

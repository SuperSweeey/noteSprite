"use client";

import { usePathname, useRouter } from "next/navigation";
import { XiaoAoMark } from "@/components/XiaoAoMark";

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { greeting, sub } = getGreeting();

  return (
    <aside className="flex min-h-screen w-[220px] flex-col border-r border-[var(--paper-border)] bg-[var(--paper-sidebar)]">
      <div className="px-5 pb-5 pt-6">
        <button onClick={() => router.push("/")} className="flex items-center gap-3">
          <XiaoAoMark size="md" variant="logo" />
          <div className="text-left">
            <span className="block font-prose text-base font-medium text-[var(--ink)]">NoteSprite</span>
            <span className="block text-[11px] text-[var(--ink-faint)]">有精灵的真实笔记~</span>
          </div>
        </button>
        <p className="mt-2.5 text-xs leading-relaxed text-[var(--ink-faint)]">
          {greeting}
          <br />
          {sub}
        </p>
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        <NavItem href="/" icon="📝" label="今天" active={pathname === "/"} />
        <NavItem href="/inbox" icon="📥" label="收集箱" active={pathname === "/inbox"} />
        <NavItem href="/ai" icon="✦" label="AI" active={pathname === "/ai"} />
      </nav>

      <div className="border-t border-[var(--paper-border)] px-4 py-3">
        <button
          onClick={() => router.push("/")}
          className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-[var(--ink-light)] transition-colors hover:bg-[var(--paper-hover)]"
        >
          ＋ 写一条新想法
        </button>
        <button
          onClick={() => router.push("/settings")}
          className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--ink-faint)] transition-colors hover:bg-[var(--paper-hover)]"
        >
          ⚙ 偏好设置
        </button>
      </div>
    </aside>
  );
}

function NavItem({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: string;
  label: string;
  active: boolean;
}) {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push(href)}
      className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all ${
        active
          ? "bg-[var(--paper-card)] font-medium text-[var(--ink)] shadow-sm"
          : "text-[var(--ink-light)] hover:bg-[var(--paper-hover)]"
      }`}
    >
      {active && <span className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-full bg-[var(--gold)]" />}
      <span className="text-base">{icon}</span>
      {label}
    </button>
  );
}

function getGreeting(): { greeting: string; sub: string } {
  const hour = new Date().getHours();
  if (hour < 6) return { greeting: "夜深了。", sub: "把最后一个念头放下，就安心去睡。" };
  if (hour < 9) return { greeting: "早安。", sub: "今天也慢慢写，慢慢想。" };
  if (hour < 14) return { greeting: "午后好。", sub: "记一页，灵感就不会轻轻溜走。" };
  if (hour < 19) return { greeting: "傍晚好。", sub: "把今天想到的事，收成自己的脉络。" };
  return { greeting: "晚上好。", sub: "安静写一点，AI 会陪着你。" };
}

"use client";

import { useRouter, usePathname } from "next/navigation";

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { greeting, sub } = getGreeting();

  return (
    <aside className="w-[200px] min-h-screen flex flex-col bg-[var(--paper-sidebar)] border-r border-[var(--paper-border)]">
      <div className="px-5 pt-6 pb-5">
        <button onClick={() => router.push("/")} className="flex items-center gap-2">
          <span className="text-lg">☕</span>
          <span className="text-base font-medium text-[var(--ink)] font-prose">Noteflow</span>
        </button>
        <p className="text-xs text-[var(--ink-faint)] mt-2.5 leading-relaxed">{greeting}<br />{sub}</p>
      </div>

      <nav className="flex-1 px-3 space-y-0.5">
        <NavItem href="/" icon="📝" label="今日" active={pathname === "/"} />
        <NavItem href="/inbox" icon="📥" label="收集箱" active={pathname === "/inbox"} />
        <NavItem href="/ai" icon="🧚" label="笔记精灵" active={pathname === "/ai"} />
      </nav>

      <div className="px-4 py-3 border-t border-[var(--paper-border)]">
        <button onClick={() => router.push("/")} className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-[var(--ink-light)] hover:bg-[var(--paper-hover)] transition-colors">
          ＋ 写一条新想法
        </button>
        <button onClick={() => router.push("/settings")} className="w-full text-left px-3 py-2 rounded-lg text-sm text-[var(--ink-faint)] hover:bg-[var(--paper-hover)] transition-colors mt-1">
          ⚙ 偏好设置
        </button>
      </div>
    </aside>
  );
}

function NavItem({ href, icon, label, active }: { href: string; icon: string; label: string; active: boolean }) {
  const router = useRouter();
  return (
    <button onClick={() => router.push(href)}
      className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm transition-all relative ${
        active ? "text-[var(--ink)] font-medium bg-[var(--paper-card)] shadow-sm" : "text-[var(--ink-light)] hover:bg-[var(--paper-hover)]"
      }`}>
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[var(--gold)] rounded-full" />}
      <span className="text-base">{icon}</span>{label}
    </button>
  );
}

function getGreeting(): { greeting: string; sub: string } {
  const h = new Date().getHours();
  if (h < 6) return { greeting: "夜深了", sub: "写完这句就去睡吧" };
  if (h < 9) return { greeting: "晨安", sub: "今日也慢慢写" };
  if (h < 14) return { greeting: "午后", sub: "泡杯茶，慢慢来" };
  if (h < 19) return { greeting: "向晚", sub: "理一理今日所得" };
  return { greeting: "入夜", sub: "安静地写些什么" };
}
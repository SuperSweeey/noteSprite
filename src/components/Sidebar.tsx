"use client";

import { usePathname, useRouter } from "next/navigation";
import { XiaoAoMark } from "@/components/XiaoAoMark";

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { greeting, sub } = getGreeting();

  return (
    <aside className="flex min-h-screen w-[232px] flex-col border-r border-black/[0.06] bg-[rgba(251,251,253,0.88)] shadow-[1px_0_0_rgba(255,255,255,0.75)_inset] backdrop-blur-2xl">
      <div className="px-5 pb-5 pt-6">
        <button onClick={() => router.push("/")} className="flex items-center gap-3 rounded-[14px] p-1 text-left transition-colors hover:bg-black/[0.035]">
          <XiaoAoMark size="md" variant="logo" />
          <div className="text-left">
            <span className="block text-[15px] font-semibold tracking-normal text-[var(--ink)]">NoteSprite</span>
            <span className="block text-[11px] leading-4 text-[var(--ink-faint)]">懂你的真实笔记</span>
          </div>
        </button>
        <p className="mt-4 px-1 text-[12px] leading-6 text-[var(--ink-faint)]">
          {greeting}
          <br />
          {sub}
        </p>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        <NavItem href="/" icon="today" label="今天" active={pathname === "/"} />
        <NavItem href="/knowledge" icon="library" label="知识库" active={pathname === "/knowledge"} />
        <NavItem href="/inbox" icon="inbox" label="收集箱" active={pathname === "/inbox"} />
        <NavItem href="/ai" icon="spark" label="AI" active={pathname === "/ai"} />
      </nav>

      <div className="border-t border-black/[0.06] px-4 py-3">
        <button
          onClick={() => router.push("/")}
          className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2.5 text-left text-[13px] text-[var(--ink-light)] transition-colors hover:bg-black/[0.04]"
        >
          <span className="text-base leading-none">+</span>
          <span>写一条新想法</span>
        </button>
        <button
          onClick={() => router.push("/settings")}
          onMouseEnter={() => router.prefetch("/settings")}
          className="mt-2 flex w-full items-center gap-2 rounded-[12px] border border-black/[0.06] bg-white px-3 py-2.5 text-left text-[13px] font-medium text-[var(--ink)] shadow-[0_10px_24px_rgba(15,23,42,0.05)] transition-colors hover:bg-black/[0.02]"
        >
          <SidebarIcon name="settings" active />
          <span>偏好设置</span>
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
  icon: IconName;
  label: string;
  active: boolean;
}) {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push(href)}
      onMouseEnter={() => router.prefetch(href)}
      className={`relative flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-[13px] transition-all ${
        active
          ? "bg-white font-medium text-[var(--ink)] shadow-[0_10px_30px_rgba(15,23,42,0.06)] ring-1 ring-black/[0.035]"
          : "text-[var(--ink-light)] hover:bg-black/[0.04] hover:text-[var(--ink)]"
      }`}
    >
      {active && <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-[var(--accent-blue)]" />}
      <SidebarIcon name={icon} active={active} />
      {label}
    </button>
  );
}

type IconName = "today" | "library" | "inbox" | "spark" | "settings";

function SidebarIcon({ name, active }: { name: IconName; active: boolean }) {
  const stroke = "currentColor";
  const common = { fill: "none", stroke, strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] ${active ? "bg-[#eef4ff] text-[var(--accent-blue)]" : "text-[var(--ink-faint)]"}`}>
      <svg viewBox="0 0 24 24" className="h-[15px] w-[15px]" aria-hidden="true">
        {name === "today" && (
          <>
            <path {...common} d="M7 4v3M17 4v3M5 9h14" />
            <path {...common} d="M6 6h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
          </>
        )}
        {name === "library" && (
          <>
            <path {...common} d="M5 5h5v14H5zM14 5h5v14h-5z" />
            <path {...common} d="M7 9h1M16 9h1M7 16h1M16 16h1" />
          </>
        )}
        {name === "inbox" && (
          <>
            <path {...common} d="M4 13h4l2 3h4l2-3h4" />
            <path {...common} d="M5 13 7 5h10l2 8v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" />
          </>
        )}
        {name === "spark" && (
          <>
            <path {...common} d="M12 3l1.8 5.1L19 10l-5.2 1.9L12 17l-1.8-5.1L5 10l5.2-1.9L12 3Z" />
            <path {...common} d="M18 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z" />
          </>
        )}
        {name === "settings" && (
          <>
            <path {...common} d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
            <path {...common} d="M18.2 13.2c.1-.4.1-.8.1-1.2s0-.8-.1-1.2l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2-1.2L13.5 3h-4l-.4 2.7a8 8 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.5c-.1.4-.1.8-.1 1.2s0 .8.1 1.2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2 1.2l.4 2.7h4l.4-2.7a8 8 0 0 0 2-1.2l2.4 1 2-3.4-2.1-1.5Z" />
          </>
        )}
      </svg>
    </span>
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

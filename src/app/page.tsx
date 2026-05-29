import { Suspense } from "react";
import { Sidebar } from "@/components/Sidebar";
import { MainWorkspace } from "@/components/MainWorkspace";
import { SpiritPanel } from "@/components/SpiritPanel";

export default function HomePage() {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <Suspense fallback={<div className="flex-1 flex items-center justify-center"><div className="w-5 h-5 border-2 border-[var(--paper-border)] border-t-[var(--gold)] rounded-full animate-spin" /></div>}>
        <MainWorkspace />
      </Suspense>
      <SpiritPanel />
    </div>
  );
}

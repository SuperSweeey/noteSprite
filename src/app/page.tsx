import { Suspense } from "react";
import HomeShell from "@/components/HomeShell";

export default function HomePage() {
  return (
    <Suspense fallback={<div className="flex h-screen flex-1 items-center justify-center"><div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--paper-border)] border-t-[var(--gold)]" /></div>}>
      <HomeShell />
    </Suspense>
  );
}

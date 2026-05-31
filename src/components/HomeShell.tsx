"use client";

import { useState } from "react";
import { MainWorkspace } from "@/components/MainWorkspace";
import { Sidebar } from "@/components/Sidebar";
import { SpiritPanel } from "@/components/SpiritPanel";

export default function HomeShell() {
  const [spiritQuestion, setSpiritQuestion] = useState("");

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <MainWorkspace onSpiritPrompt={setSpiritQuestion} />
      <SpiritPanel
        initialQuestion={spiritQuestion}
        onInitialQuestionConsumed={() => setSpiritQuestion("")}
      />
    </div>
  );
}

import { prisma } from "../src/lib/prisma";

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "dev@noteflow.local" },
    update: {},
    create: { email: "dev@noteflow.local", name: "Dev User" },
  });
  const note = await prisma.note.create({
    data: {
      userId: user.id,
      title: "save-regression",
      contentMd: "save regression body",
      plainText: "save regression body",
      status: "inbox",
    },
  });

  try {
    const blankContent = await fetch(`http://localhost:3000/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "   " }),
    });
    assert(blankContent.status === 400, "空白正文 PATCH 必须返回 400");

    const blankTitle = await fetch(`http://localhost:3000/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "   " }),
    });
    assert(blankTitle.status === 400, "空白标题 PATCH 必须返回 400");

    const createBlank = await fetch("http://localhost:3000/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "   " }),
    });
    assert(createBlank.status === 400, "空白新笔记 POST 必须返回 400");

    console.log("note save regression passed");
  } finally {
    await prisma.note.deleteMany({ where: { id: note.id } });
    await prisma.$disconnect();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});

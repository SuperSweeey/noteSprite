import { createFileDrop, createTextDrop, DropError } from "../src/lib/drop";
import { prisma } from "../src/lib/prisma";

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "drop-regression@noteflow.local" },
    update: { settings: JSON.stringify({ knowledge: { autoAnalyze: false } }) },
    create: { email: "drop-regression@noteflow.local", name: "Drop Regression", settings: JSON.stringify({ knowledge: { autoAnalyze: false } }) },
  });

  const createdNoteIds: string[] = [];

  try {
    try {
      await createTextDrop(user.id, "   ");
      throw new Error("空白丢万物文本不应创建笔记");
    } catch (error) {
      assert(error instanceof DropError, "空白丢万物文本必须返回结构化 DropError");
      assert(error.status === 400, "空白丢万物文本必须返回 400");
    }

    const text = await createTextDrop(user.id, "丢万物文字回归");
    assert(text.kind === "text", "文字输入必须创建普通文本笔记");
    assert(text.note.type === "manual", "文字笔记 type 必须是 manual");
    createdNoteIds.push(text.note.id);

    const imageFile = new File([tinyPng()], "drop-image.png", { type: "image/png" });
    const image = await createFileDrop(user.id, imageFile);
    assert(image.kind === "image", "PNG 必须识别成图片笔记");
    assert(image.note.type === "image", "图片笔记 type 必须是 image");
    assert(image.note.assets?.[0]?.fileType === "image", "图片笔记必须保存 image Asset");
    assert(image.note.contentMd.includes(`/api/assets/${image.note.assets[0].id}/file`), "图片正文必须引用受控 asset URL");
    createdNoteIds.push(image.note.id);

    const audioFile = new File([new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0])], "drop-audio.wav", { type: "audio/wav" });
    try {
      const media = await createFileDrop(user.id, audioFile);
      assert(media.kind === "media", "音频配置完整时必须进入媒体转录分支");
      assert(media.note.type === "upload", "音频笔记 type 必须是 upload");
      assert(media.note.assets?.[0]?.fileType === "audio", "音频笔记必须保存 audio Asset");
      createdNoteIds.push(media.note.id);
    } catch (error) {
      assert(error instanceof DropError, "音频配置不完整时必须返回结构化 DropError");
      assert(/转录预检失败/.test(error.message), "音频配置不完整时必须给出可读预检失败");
    }

    console.log("Drop regression passed");
  } finally {
    if (createdNoteIds.length > 0) {
      await prisma.note.deleteMany({ where: { id: { in: createdNoteIds } } });
    }
    await prisma.$disconnect();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function tinyPng() {
  return Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
    0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 255, 255, 63,
    0, 5, 254, 2, 254, 167, 53, 129, 132, 0, 0, 0, 0, 73, 69,
    78, 68, 174, 66, 96, 130,
  ]);
}

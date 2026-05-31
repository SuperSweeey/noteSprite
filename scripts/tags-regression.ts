import { prisma } from "../src/lib/prisma";

const baseUrl = "http://localhost:3000";

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "dev@noteflow.local" },
    update: {},
    create: { email: "dev@noteflow.local", name: "Dev User" },
  });
  const marker = `tags-regression-${Date.now()}`;
  const tagRoot = `测试标签-${Date.now()}`;
  const firstLeafPath = `${tagRoot}/地方债务`;
  const renamedLeafPath = `${tagRoot}/城投债务`;
  const note = await prisma.note.create({
    data: {
      userId: user.id,
      title: marker,
      contentMd: marker,
      plainText: marker,
      status: "inbox",
    },
  });

  try {
    const addResp = await fetch(`${baseUrl}/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagPath: firstLeafPath }),
    });
    await assertOk(addResp, "添加层级标签失败");
    const added = await addResp.json();
    assert(added.contentMd === marker, "添加标签不能改写笔记正文");
    assert(hasTag(added, tagRoot), "添加子标签时必须自动挂上父级标签");
    assert(hasTag(added, firstLeafPath), "添加子标签后必须能看到完整标签");

    const parentFilter = await fetch(`${baseUrl}/api/notes?tag=${encodeURIComponent(tagRoot)}&search=${encodeURIComponent(marker)}`);
    assert(parentFilter.ok, "父级标签筛选请求失败");
    const parentData = await parentFilter.json();
    assert(parentData.notes.some((item: any) => item.id === note.id), "父级标签必须聚合筛到子标签笔记");

    const leaf = added.tags.find((item: any) => item.tag.fullPath === firstLeafPath)?.tag;
    assert(leaf?.id, "缺少叶子标签 id");
    const renameResp = await fetch(`${baseUrl}/api/tags`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: leaf.id, name: "城投债务" }),
    });
    await assertOk(renameResp, "重命名标签失败");
    const renamedTags = (await renameResp.json()).tags;
    assert(renamedTags.some((tag: any) => tag.fullPath === renamedLeafPath), "重命名后完整路径没有更新");

    const reloadedResp = await fetch(`${baseUrl}/api/notes/${note.id}`);
    assert(reloadedResp.ok, "重新读取笔记失败");
    const reloaded = await reloadedResp.json();
    const renamedLeaf = reloaded.tags.find((item: any) => item.tag.fullPath === renamedLeafPath)?.tag;
    assert(renamedLeaf?.id, "笔记关系没有跟随标签重命名");

    const deleteRelationResp = await fetch(`${baseUrl}/api/notes/${note.id}?tagId=${renamedLeaf.id}`, { method: "DELETE" });
    await assertOk(deleteRelationResp, "删除笔记标签关系失败");
    const withoutTagResp = await fetch(`${baseUrl}/api/notes/${note.id}`);
    assert(withoutTagResp.ok, "删除后重新读取笔记失败");
    const withoutTag = await withoutTagResp.json();
    assert(!hasTag(withoutTag, renamedLeafPath), "删除叶子标签关系后笔记不应再带该标签");

    const tagsResp = await fetch(`${baseUrl}/api/tags`);
    assert(tagsResp.ok, "标签列表请求失败");
    const tags = (await tagsResp.json()).tags;
    const parent = tags.find((tag: any) => tag.fullPath === tagRoot);
    assert(parent && Number(parent.noteCount) >= 0, "标签计数必须可读");

    const deleteTagResp = await fetch(`${baseUrl}/api/tags?id=${parent.id}`, { method: "DELETE" });
    await assertOk(deleteTagResp, "删除标签树失败");
    const afterDeleteResp = await fetch(`${baseUrl}/api/tags`);
    assert(afterDeleteResp.ok, "删除后标签列表请求失败");
    const afterDeleteTags = (await afterDeleteResp.json()).tags;
    assert(!afterDeleteTags.some((tag: any) => tag.fullPath === tagRoot || tag.fullPath.startsWith(`${tagRoot}/`)), "删除父级标签必须删除整棵子树");

    console.log("tags regression passed");
  } finally {
    await prisma.note.deleteMany({ where: { id: note.id } });
    await prisma.$disconnect();
  }
}

function hasTag(note: any, fullPath: string) {
  return Boolean(note.tags?.some((item: any) => item.tag?.fullPath === fullPath));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function assertOk(resp: Response, message: string) {
  if (!resp.ok) {
    throw new Error(`${message}：${await resp.text()}`);
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});

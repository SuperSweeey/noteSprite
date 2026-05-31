import { prisma } from "../src/lib/prisma";
import { looksMojibake, resolveSettings } from "../src/lib/ai-config";

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true, settings: true } });
  let repaired = 0;

  for (const user of users) {
    const before = user.settings || "{}";
    const beforeHadMojibake = looksMojibake(before);
    const resolved = resolveSettings(before);
    const after = JSON.stringify(resolved);

    if (beforeHadMojibake || before !== after) {
      await prisma.user.update({
        where: { id: user.id },
        data: { settings: after },
      });
      repaired += 1;
      console.log(`repaired settings for ${user.email || user.id}`);
    }
  }

  console.log(`settings repair complete: ${repaired}/${users.length} users updated`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

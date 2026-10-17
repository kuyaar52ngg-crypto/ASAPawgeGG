import { prisma } from "./client";

/** Read a JSON setting (Setting table) with a typed default. */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown, updatedById?: string): Promise<void> {
  const json = value as never;
  await prisma.setting.upsert({
    where: { key },
    create: { key, value: json, updatedById },
    update: { value: json, updatedById },
  });
}

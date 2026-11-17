/**
 * Proves the uploads volume is writable at startup. A read-only or root-owned
 * Azure Files mount otherwise surfaces only as a failed upload much later,
 * with no clue in the logs.
 */
export async function checkStorage() {
  const target = process.env.STORAGE_PATH ?? "./uploads";
  try {
    const { randomUUID } = await import("node:crypto");
    const { storage } = await import("@/lib/storage");
    const key = `${randomUUID()}.txt`;
    await storage.put(key, new Uint8Array([0x6f, 0x6b]));
    await storage.get(key);
    await storage.delete(key);
    console.log(`[storage] uploads writable at ${target}`);
  } catch (error: any) {
    console.error(
      `[storage] UPLOADS NOT WRITABLE at ${target} — chat and assistant attachments will fail:`,
      error?.code ?? "",
      error?.message ?? error
    );
  }
}

void checkStorage();

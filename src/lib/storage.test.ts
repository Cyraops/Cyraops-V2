import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalFilesystemStorage } from "./storage";

describe("local file storage", () => {
  it("writes and reads opaque file keys and refuses path traversal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "company-os-storage-"));
    const storage = new LocalFilesystemStorage(directory);
    const key = "76dca236-05d5-4ea5-a953-b17e41f4ab63.txt";
    try {
      await storage.put(key, Buffer.from("private note"));
      assert.equal((await storage.get(key)).toString(), "private note");
      await assert.rejects(storage.get("../../private-key"), /Invalid storage key/);
      await storage.delete(key);
      await assert.rejects(storage.get(key));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

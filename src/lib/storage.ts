import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolve } from "node:path";

export interface StorageAdapter {
  put(key: string, contents: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

function safeKey(key: string) {
  if (!/^[a-f0-9-]{36}\.[a-z0-9]{1,8}$/.test(key)) throw new Error("Invalid storage key");
  return key;
}

export class LocalFilesystemStorage implements StorageAdapter {
  constructor(private readonly root = resolve(/* turbopackIgnore: true */ process.cwd(), process.env.STORAGE_PATH ?? "./uploads")) {}

  async put(key: string, contents: Uint8Array) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeFile(join(this.root, safeKey(key)), contents, { flag: "wx", mode: 0o600 });
  }

  async get(key: string) { return readFile(join(this.root, safeKey(key))); }
  async delete(key: string) { await unlink(join(this.root, safeKey(key))); }
}

export const storage: StorageAdapter = new LocalFilesystemStorage();

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEncrypted } from "./crypto.js";
import { readEncryptionMeta } from "./metadata.js";
import { initEncryption } from "./setup.js";

// Mock keychain for testing (don't touch real keychain)
vi.mock("./keychain.js", () => {
  const store = new Map<string, Buffer>();
  return {
    keychainSet: (account: string, value: Buffer) => store.set(account, value),
    keychainGet: (account: string) => store.get(account) ?? null,
    keychainDelete: (account: string) => store.delete(account),
    keychainHasKeys: () =>
      store.has("workspace-key") && store.has("config-key") && store.has("encryption-salt"),
    keychainStoreAll: (keys: { workspaceKey: Buffer; configKey: Buffer; salt: Buffer }) => {
      store.set("workspace-key", keys.workspaceKey);
      store.set("config-key", keys.configKey);
      store.set("encryption-salt", keys.salt);
    },
    keychainGetAll: () => {
      const wk = store.get("workspace-key");
      const ck = store.get("config-key");
      const s = store.get("encryption-salt");
      if (!wk || !ck || !s) {
        return null;
      }
      return { workspaceKey: wk, configKey: ck, salt: s };
    },
    keychainClearAll: () => store.clear(),
  };
});

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-setup-test-"));
  // Create some workspace files
  await fs.writeFile(path.join(tmpDir, "MEMORY.md"), "# My memories");
  await fs.writeFile(path.join(tmpDir, "USER.md"), "# User info");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("initEncryption", () => {
  it("encrypts workspace files and creates metadata", async () => {
    const result = await initEncryption(tmpDir, "test-password", ["MEMORY.md", "USER.md"]);

    expect(result.success).toBe(true);
    expect(result.migrated).toEqual(["MEMORY.md", "USER.md"]);
    expect(result.errors).toEqual([]);

    // Verify files are encrypted
    const memoryRaw = await fs.readFile(path.join(tmpDir, "MEMORY.md"));
    expect(isEncrypted(memoryRaw)).toBe(true);

    const userRaw = await fs.readFile(path.join(tmpDir, "USER.md"));
    expect(isEncrypted(userRaw)).toBe(true);

    // Verify metadata exists
    const meta = await readEncryptionMeta(tmpDir);
    expect(meta).not.toBeNull();
    expect(meta!.enabled).toBe(true);
    expect(meta!.encryptedPatterns).toEqual(["MEMORY.md", "USER.md"]);
  });

  it("skips missing files gracefully", async () => {
    const result = await initEncryption(tmpDir, "password", ["MEMORY.md", "MISSING.md"]);

    expect(result.success).toBe(true);
    expect(result.migrated).toEqual(["MEMORY.md"]);
    expect(result.skipped).toEqual(["MISSING.md"]);
  });
});

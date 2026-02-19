/**
 * End-to-end integration tests for workspace encryption.
 *
 * Tests the full lifecycle: init → read → write → re-encrypt → change password → disable
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEncrypted } from "./crypto.js";
import { clearActiveKeys, readFileAutoDecrypt, setActiveKeys } from "./fs-middleware.js";
import { bootstrapEncryption } from "./integration.js";
import { readEncryptionMeta } from "./metadata.js";
import { changePassword, disableEncryption, initEncryption } from "./setup.js";

// Mock keychain for testing
const keychainStore = new Map<string, Buffer>();

vi.mock("./keychain.js", () => ({
  keychainSet: (account: string, value: Buffer) => keychainStore.set(account, value),
  keychainGet: (account: string) => keychainStore.get(account) ?? null,
  keychainDelete: (account: string) => keychainStore.delete(account),
  keychainHasKeys: () =>
    keychainStore.has("workspace-key") &&
    keychainStore.has("config-key") &&
    keychainStore.has("encryption-salt"),
  keychainStoreAll: (keys: { workspaceKey: Buffer; configKey: Buffer; salt: Buffer }) => {
    keychainStore.set("workspace-key", keys.workspaceKey);
    keychainStore.set("config-key", keys.configKey);
    keychainStore.set("encryption-salt", keys.salt);
  },
  keychainGetAll: () => {
    const wk = keychainStore.get("workspace-key");
    const ck = keychainStore.get("config-key");
    const s = keychainStore.get("encryption-salt");
    if (!wk || !ck || !s) {
      return null;
    }
    return { workspaceKey: wk, configKey: ck, salt: s };
  },
  keychainClearAll: () => keychainStore.clear(),
}));

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-e2e-enc-"));
  keychainStore.clear();
  clearActiveKeys();

  // Create a realistic workspace
  await fs.writeFile(path.join(tmpDir, "MEMORY.md"), "# Memories\n\nI remember things.");
  await fs.writeFile(path.join(tmpDir, "USER.md"), "# User\n\nName: Test User");
  await fs.writeFile(path.join(tmpDir, "IDENTITY.md"), "# Identity\n\nI am Cato.");
  await fs.writeFile(path.join(tmpDir, "TOOLS.md"), "# Tools\n\nSSH: 192.168.1.1");
  await fs.writeFile(path.join(tmpDir, "HEARTBEAT.md"), "# Heartbeat\n\nCheck email.");
  await fs.writeFile(path.join(tmpDir, "AGENTS.md"), "# Agents\n\nBe helpful.");
  await fs.writeFile(path.join(tmpDir, "SOUL.md"), "# Soul\n\nBe genuine.");
  await fs.mkdir(path.join(tmpDir, "memory"));
  await fs.writeFile(path.join(tmpDir, "memory", "2026-02-19.md"), "# Today\n\nDid stuff.");
});

afterEach(async () => {
  clearActiveKeys();
  keychainStore.clear();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("full encryption lifecycle", () => {
  it("init → read → verify encrypted on disk", async () => {
    // 1. Initialize encryption
    const result = await initEncryption(tmpDir, "test-password-123");
    expect(result.success).toBe(true);
    expect(result.migrated.length).toBeGreaterThan(0);

    // 2. Verify files are encrypted on disk
    const memoryRaw = await fs.readFile(path.join(tmpDir, "MEMORY.md"));
    expect(isEncrypted(memoryRaw)).toBe(true);

    const userRaw = await fs.readFile(path.join(tmpDir, "USER.md"));
    expect(isEncrypted(userRaw)).toBe(true);

    // 3. Set active keys (simulating gateway startup)
    const wk = keychainStore.get("workspace-key")!;
    setActiveKeys(wk, keychainStore.get("config-key")!);

    // 4. Verify transparent decryption
    const memoryContent = await readFileAutoDecrypt(path.join(tmpDir, "MEMORY.md"));
    expect(memoryContent).toBe("# Memories\n\nI remember things.");

    const userContent = await readFileAutoDecrypt(path.join(tmpDir, "USER.md"));
    expect(userContent).toBe("# User\n\nName: Test User");

    // 5. Metadata should exist
    const meta = await readEncryptionMeta(tmpDir);
    expect(meta).not.toBeNull();
    expect(meta!.enabled).toBe(true);
  });

  it("handles agent writing plaintext, then re-encrypts on bootstrap", async () => {
    // 1. Init encryption
    await initEncryption(tmpDir, "test-password-123");

    // 2. Simulate agent writing a new file in plaintext
    await fs.writeFile(path.join(tmpDir, "MEMORY.md"), "# Updated memories\n\nNew stuff.");

    // 3. Verify file is plaintext on disk now
    const raw = await fs.readFile(path.join(tmpDir, "MEMORY.md"));
    expect(isEncrypted(raw)).toBe(false);

    // 4. Bootstrap encryption (simulating gateway restart)
    const bootstrap = await bootstrapEncryption(tmpDir);
    expect(bootstrap.enabled).toBe(true);
    expect(bootstrap.keysLoaded).toBe(true);
    expect(bootstrap.reEncrypted).toContain("MEMORY.md");

    // 5. File should be encrypted again
    const rawAfter = await fs.readFile(path.join(tmpDir, "MEMORY.md"));
    expect(isEncrypted(rawAfter)).toBe(true);

    // 6. Content should be the updated version
    const content = await readFileAutoDecrypt(path.join(tmpDir, "MEMORY.md"));
    expect(content).toBe("# Updated memories\n\nNew stuff.");
  });

  it("handles memory/*.md files during bootstrap re-encryption", async () => {
    // 1. Init encryption
    await initEncryption(tmpDir, "test-password-123");

    // 2. Simulate agent writing a new daily memory file
    await fs.writeFile(path.join(tmpDir, "memory", "2026-02-20.md"), "# Tomorrow\n\nFuture stuff.");

    // 3. Bootstrap should pick up and encrypt the new file
    const bootstrap = await bootstrapEncryption(tmpDir);
    expect(bootstrap.reEncrypted).toContain("memory/2026-02-20.md");

    // 4. New file should be encrypted
    const raw = await fs.readFile(path.join(tmpDir, "memory", "2026-02-20.md"));
    expect(isEncrypted(raw)).toBe(true);
  });

  it("change password re-encrypts all files", async () => {
    // 1. Init with original password
    await initEncryption(tmpDir, "original-password");

    // 2. Change password
    const result = await changePassword(tmpDir, "original-password", "new-password-123");
    expect(result.success).toBe(true);

    // 3. New keys should be in keychain
    const newWk = keychainStore.get("workspace-key")!;
    setActiveKeys(newWk, keychainStore.get("config-key")!);

    // 4. Files should be readable with new keys
    const content = await readFileAutoDecrypt(path.join(tmpDir, "MEMORY.md"));
    expect(content).toBe("# Memories\n\nI remember things.");
  });

  it("disable decrypts everything and cleans up", async () => {
    // 1. Init encryption
    await initEncryption(tmpDir, "test-password-123");

    // Verify encrypted
    expect(isEncrypted(await fs.readFile(path.join(tmpDir, "MEMORY.md")))).toBe(true);

    // 2. Disable encryption
    await disableEncryption(tmpDir, "test-password-123");

    // 3. Files should be plaintext
    const content = await fs.readFile(path.join(tmpDir, "MEMORY.md"), "utf-8");
    expect(content).toBe("# Memories\n\nI remember things.");

    // 4. Metadata should be gone
    const meta = await readEncryptionMeta(tmpDir);
    expect(meta).toBeNull();

    // 5. Keychain should be cleared
    expect(keychainStore.size).toBe(0);
  });

  it("unencrypted files pass through transparently", async () => {
    // Without encryption configured, everything should work as normal
    const content = await readFileAutoDecrypt(path.join(tmpDir, "AGENTS.md"));
    expect(content).toBe("# Agents\n\nBe helpful.");
  });
});

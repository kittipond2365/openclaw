import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encryptString, isEncrypted } from "./crypto.js";
import {
  migrateFileToEncrypted,
  migrateFileToPlaintext,
  migrateWorkspaceToEncrypted,
  readFileEncrypted,
  writeFileEncrypted,
} from "./workspace-fs.js";

const TEST_KEY = crypto.randomBytes(32);
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-enc-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("readFileEncrypted", () => {
  it("reads plaintext file when no key", async () => {
    const filePath = path.join(tmpDir, "test.md");
    await fs.writeFile(filePath, "hello plaintext");
    const content = await readFileEncrypted(filePath, null);
    expect(content).toBe("hello plaintext");
  });

  it("reads plaintext file even when key is provided", async () => {
    const filePath = path.join(tmpDir, "test.md");
    await fs.writeFile(filePath, "hello plaintext");
    const content = await readFileEncrypted(filePath, TEST_KEY);
    expect(content).toBe("hello plaintext");
  });

  it("reads encrypted file with correct key", async () => {
    const filePath = path.join(tmpDir, "test.md");
    const encrypted = encryptString("secret content", TEST_KEY);
    await fs.writeFile(filePath, encrypted);
    const content = await readFileEncrypted(filePath, TEST_KEY);
    expect(content).toBe("secret content");
  });

  it("throws when encrypted file has no key", async () => {
    const filePath = path.join(tmpDir, "test.md");
    const encrypted = encryptString("secret", TEST_KEY);
    await fs.writeFile(filePath, encrypted);
    await expect(readFileEncrypted(filePath, null)).rejects.toThrow(/no key provided/);
  });

  it("throws for non-existent file", async () => {
    await expect(readFileEncrypted(path.join(tmpDir, "nope.md"), null)).rejects.toThrow();
  });
});

describe("writeFileEncrypted", () => {
  it("writes plaintext when no key", async () => {
    const filePath = path.join(tmpDir, "out.md");
    await writeFileEncrypted(filePath, "plain", null);
    const raw = await fs.readFile(filePath, "utf-8");
    expect(raw).toBe("plain");
  });

  it("writes encrypted when key provided", async () => {
    const filePath = path.join(tmpDir, "out.md");
    await writeFileEncrypted(filePath, "secret", TEST_KEY);
    const raw = await fs.readFile(filePath);
    expect(isEncrypted(raw)).toBe(true);
  });

  it("round-trips through write then read", async () => {
    const filePath = path.join(tmpDir, "round.md");
    await writeFileEncrypted(filePath, "round trip 🐾", TEST_KEY);
    const content = await readFileEncrypted(filePath, TEST_KEY);
    expect(content).toBe("round trip 🐾");
  });

  it("creates parent directories", async () => {
    const filePath = path.join(tmpDir, "sub", "dir", "deep.md");
    await writeFileEncrypted(filePath, "deep", TEST_KEY);
    const content = await readFileEncrypted(filePath, TEST_KEY);
    expect(content).toBe("deep");
  });
});

describe("migrateFileToEncrypted", () => {
  it("encrypts a plaintext file in-place", async () => {
    const filePath = path.join(tmpDir, "migrate.md");
    await fs.writeFile(filePath, "was plaintext");
    const result = await migrateFileToEncrypted(filePath, TEST_KEY);
    expect(result).toBe(true);
    const raw = await fs.readFile(filePath);
    expect(isEncrypted(raw)).toBe(true);
    // Verify content is preserved
    const content = await readFileEncrypted(filePath, TEST_KEY);
    expect(content).toBe("was plaintext");
  });

  it("skips already-encrypted file", async () => {
    const filePath = path.join(tmpDir, "already.md");
    const encrypted = encryptString("already encrypted", TEST_KEY);
    await fs.writeFile(filePath, encrypted);
    const result = await migrateFileToEncrypted(filePath, TEST_KEY);
    expect(result).toBe(false);
  });

  it("returns false for non-existent file", async () => {
    const result = await migrateFileToEncrypted(path.join(tmpDir, "nope.md"), TEST_KEY);
    expect(result).toBe(false);
  });
});

describe("migrateFileToPlaintext", () => {
  it("decrypts an encrypted file in-place", async () => {
    const filePath = path.join(tmpDir, "decrypt.md");
    const encrypted = encryptString("was encrypted", TEST_KEY);
    await fs.writeFile(filePath, encrypted);
    const result = await migrateFileToPlaintext(filePath, TEST_KEY);
    expect(result).toBe(true);
    const raw = await fs.readFile(filePath, "utf-8");
    expect(raw).toBe("was encrypted");
  });

  it("skips plaintext file", async () => {
    const filePath = path.join(tmpDir, "plain.md");
    await fs.writeFile(filePath, "already plain");
    const result = await migrateFileToPlaintext(filePath, TEST_KEY);
    expect(result).toBe(false);
  });
});

describe("migrateWorkspaceToEncrypted", () => {
  it("migrates specified files", async () => {
    await fs.writeFile(path.join(tmpDir, "MEMORY.md"), "memories");
    await fs.writeFile(path.join(tmpDir, "USER.md"), "user info");

    const result = await migrateWorkspaceToEncrypted(tmpDir, TEST_KEY, [
      "MEMORY.md",
      "USER.md",
      "MISSING.md",
    ]);

    expect(result.migrated).toEqual(["MEMORY.md", "USER.md"]);
    expect(result.skipped).toEqual(["MISSING.md"]);
    expect(result.errors).toEqual([]);

    // Verify encrypted
    const raw = await fs.readFile(path.join(tmpDir, "MEMORY.md"));
    expect(isEncrypted(raw)).toBe(true);
  });
});

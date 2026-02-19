import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createEncryptionMeta,
  isEncryptionConfigured,
  readEncryptionMeta,
  writeEncryptionMeta,
} from "./metadata.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-meta-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("createEncryptionMeta", () => {
  it("creates valid metadata object", () => {
    const salt = crypto.randomBytes(32);
    const meta = createEncryptionMeta(salt, ["MEMORY.md", "USER.md"]);

    expect(meta.version).toBe(1);
    expect(meta.enabled).toBe(true);
    expect(meta.salt).toBe(salt.toString("hex"));
    expect(meta.encryptedPatterns).toEqual(["MEMORY.md", "USER.md"]);
    expect(meta.createdAt).toBeTruthy();
    expect(meta.lastKeyChangeAt).toBeTruthy();
  });
});

describe("readEncryptionMeta / writeEncryptionMeta", () => {
  it("round-trips metadata", async () => {
    const salt = crypto.randomBytes(32);
    const meta = createEncryptionMeta(salt, ["MEMORY.md"]);

    await writeEncryptionMeta(tmpDir, meta);
    const read = await readEncryptionMeta(tmpDir);

    expect(read).toEqual(meta);
  });

  it("returns null when no metadata exists", async () => {
    const meta = await readEncryptionMeta(tmpDir);
    expect(meta).toBeNull();
  });
});

describe("isEncryptionConfigured", () => {
  it("returns false when no metadata", async () => {
    expect(await isEncryptionConfigured(tmpDir)).toBe(false);
  });

  it("returns true when enabled", async () => {
    const salt = crypto.randomBytes(32);
    const meta = createEncryptionMeta(salt, []);
    await writeEncryptionMeta(tmpDir, meta);
    expect(await isEncryptionConfigured(tmpDir)).toBe(true);
  });

  it("returns false when disabled", async () => {
    const salt = crypto.randomBytes(32);
    const meta = createEncryptionMeta(salt, []);
    meta.enabled = false;
    await writeEncryptionMeta(tmpDir, meta);
    expect(await isEncryptionConfigured(tmpDir)).toBe(false);
  });
});

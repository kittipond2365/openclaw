import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveKeys, generateSalt } from "./key-derivation.js";

describe("deriveKeys", () => {
  it("derives two 32-byte keys", async () => {
    const result = await deriveKeys("test-password");
    expect(result.workspaceKey.length).toBe(32);
    expect(result.configKey.length).toBe(32);
    expect(result.salt.length).toBe(32);
  });

  it("workspace and config keys are different", async () => {
    const result = await deriveKeys("test-password");
    expect(result.workspaceKey.equals(result.configKey)).toBe(false);
  });

  it("same password + salt produces same keys", async () => {
    const salt = generateSalt();
    const a = await deriveKeys("my-password", salt);
    const b = await deriveKeys("my-password", salt);
    expect(a.workspaceKey.equals(b.workspaceKey)).toBe(true);
    expect(a.configKey.equals(b.configKey)).toBe(true);
  });

  it("different passwords produce different keys", async () => {
    const salt = generateSalt();
    const a = await deriveKeys("password-1", salt);
    const b = await deriveKeys("password-2", salt);
    expect(a.workspaceKey.equals(b.workspaceKey)).toBe(false);
    expect(a.configKey.equals(b.configKey)).toBe(false);
  });

  it("different salts produce different keys", async () => {
    const a = await deriveKeys("same-password", crypto.randomBytes(32));
    const b = await deriveKeys("same-password", crypto.randomBytes(32));
    expect(a.workspaceKey.equals(b.workspaceKey)).toBe(false);
  });

  it("generates salt when not provided", async () => {
    const a = await deriveKeys("password");
    const b = await deriveKeys("password");
    // Different random salts each time
    expect(a.salt.equals(b.salt)).toBe(false);
  });
});

describe("generateSalt", () => {
  it("produces 32-byte salt", () => {
    expect(generateSalt().length).toBe(32);
  });

  it("produces unique salts", () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(a.equals(b)).toBe(false);
  });
});

import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { decrypt, decryptString, encrypt, encryptString, isEncrypted } from "./crypto.js";

const TEST_KEY = crypto.randomBytes(32);

describe("encrypt/decrypt", () => {
  it("round-trips plaintext", () => {
    const plaintext = Buffer.from("hello, openclaw!");
    const encrypted = encrypt(plaintext, TEST_KEY);
    const decrypted = decrypt(encrypted.buffer, TEST_KEY);
    expect(decrypted).toEqual(plaintext);
  });

  it("round-trips empty buffer", () => {
    const plaintext = Buffer.alloc(0);
    const encrypted = encrypt(plaintext, TEST_KEY);
    const decrypted = decrypt(encrypted.buffer, TEST_KEY);
    expect(decrypted).toEqual(plaintext);
  });

  it("round-trips large data", () => {
    const plaintext = crypto.randomBytes(1024 * 100); // 100KB
    const encrypted = encrypt(plaintext, TEST_KEY);
    const decrypted = decrypt(encrypted.buffer, TEST_KEY);
    expect(decrypted).toEqual(plaintext);
  });

  it("produces different ciphertext each time (unique nonce)", () => {
    const plaintext = Buffer.from("same input");
    const a = encrypt(plaintext, TEST_KEY);
    const b = encrypt(plaintext, TEST_KEY);
    expect(a.buffer.equals(b.buffer)).toBe(false);
  });

  it("rejects wrong key", () => {
    const plaintext = Buffer.from("secret");
    const encrypted = encrypt(plaintext, TEST_KEY);
    const wrongKey = crypto.randomBytes(32);
    expect(() => decrypt(encrypted.buffer, wrongKey)).toThrow();
  });

  it("rejects tampered ciphertext", () => {
    const plaintext = Buffer.from("secret");
    const encrypted = encrypt(plaintext, TEST_KEY);
    // Flip a byte in the ciphertext region
    const tampered = Buffer.from(encrypted.buffer);
    tampered[20] ^= 0xff;
    expect(() => decrypt(tampered, TEST_KEY)).toThrow();
  });

  it("rejects tampered auth tag", () => {
    const plaintext = Buffer.from("secret");
    const encrypted = encrypt(plaintext, TEST_KEY);
    const tampered = Buffer.from(encrypted.buffer);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decrypt(tampered, TEST_KEY)).toThrow();
  });

  it("rejects too-short blob", () => {
    expect(() => decrypt(Buffer.alloc(10), TEST_KEY)).toThrow(/too short/);
  });

  it("rejects blob without magic header", () => {
    const blob = Buffer.alloc(100);
    expect(() => decrypt(blob, TEST_KEY)).toThrow(/magic header/);
  });

  it("rejects invalid key length", () => {
    const short = crypto.randomBytes(16);
    expect(() => encrypt(Buffer.from("x"), short)).toThrow(/32 bytes/);
    expect(() => decrypt(Buffer.alloc(100), short)).toThrow(/32 bytes/);
  });
});

describe("encryptString/decryptString", () => {
  it("round-trips UTF-8 string", () => {
    const text = "こんにちは OpenClaw 🐾";
    const encrypted = encryptString(text, TEST_KEY);
    const decrypted = decryptString(encrypted, TEST_KEY);
    expect(decrypted).toBe(text);
  });

  it("handles empty string", () => {
    const encrypted = encryptString("", TEST_KEY);
    expect(decryptString(encrypted, TEST_KEY)).toBe("");
  });
});

describe("isEncrypted", () => {
  it("returns true for encrypted data", () => {
    const encrypted = encrypt(Buffer.from("test"), TEST_KEY);
    expect(isEncrypted(encrypted.buffer)).toBe(true);
  });

  it("returns false for plaintext", () => {
    expect(isEncrypted(Buffer.from("hello world"))).toBe(false);
  });

  it("returns false for empty buffer", () => {
    expect(isEncrypted(Buffer.alloc(0))).toBe(false);
  });

  it("returns false for short buffer", () => {
    expect(isEncrypted(Buffer.from("OC"))).toBe(false);
  });
});

/**
 * AES-256-GCM encryption/decryption using Node's built-in crypto module.
 *
 * File format: [12-byte nonce][ciphertext][16-byte auth tag]
 * All operations are synchronous for simplicity — files are small.
 */
import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const NONCE_LENGTH = 12; // 96 bits, recommended for GCM
const TAG_LENGTH = 16; // 128 bits

/** Magic bytes to identify encrypted files: "OCENC" + version byte */
const MAGIC = Buffer.from([0x4f, 0x43, 0x45, 0x4e, 0x43, 0x01]); // "OCENC\x01"
const MAGIC_LENGTH = MAGIC.length;

export interface EncryptedBlob {
  /** Raw encrypted buffer: magic + nonce + ciphertext + tag */
  buffer: Buffer;
}

/**
 * Encrypt plaintext with AES-256-GCM.
 *
 * @param plaintext - Data to encrypt
 * @param key - 256-bit (32-byte) encryption key
 * @returns EncryptedBlob containing magic + nonce + ciphertext + auth tag
 */
export function encrypt(plaintext: Buffer, key: Buffer): EncryptedBlob {
  if (key.length !== 32) {
    throw new Error(`Encryption key must be 32 bytes, got ${key.length}`);
  }

  const nonce = crypto.randomBytes(NONCE_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, nonce, {
    authTagLength: TAG_LENGTH,
  });

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    buffer: Buffer.concat([MAGIC, nonce, ciphertext, tag]),
  };
}

/**
 * Decrypt an AES-256-GCM encrypted blob.
 *
 * @param blob - Encrypted data (magic + nonce + ciphertext + tag)
 * @param key - 256-bit (32-byte) encryption key
 * @returns Decrypted plaintext
 * @throws If auth tag verification fails (tampered data)
 */
export function decrypt(blob: Buffer, key: Buffer): Buffer {
  if (key.length !== 32) {
    throw new Error(`Encryption key must be 32 bytes, got ${key.length}`);
  }

  if (blob.length < MAGIC_LENGTH + NONCE_LENGTH + TAG_LENGTH) {
    throw new Error("Encrypted blob too short — missing header, nonce, or auth tag");
  }

  const magic = blob.subarray(0, MAGIC_LENGTH);
  if (!magic.equals(MAGIC)) {
    throw new Error("Invalid encrypted file: missing OCENC magic header");
  }

  const nonce = blob.subarray(MAGIC_LENGTH, MAGIC_LENGTH + NONCE_LENGTH);
  const tag = blob.subarray(blob.length - TAG_LENGTH);
  const ciphertext = blob.subarray(MAGIC_LENGTH + NONCE_LENGTH, blob.length - TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, nonce, {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Check if a buffer starts with the OCENC magic header.
 * Use this to detect whether a file is encrypted without attempting decryption.
 */
export function isEncrypted(data: Buffer): boolean {
  if (data.length < MAGIC_LENGTH) {
    return false;
  }
  return data.subarray(0, MAGIC_LENGTH).equals(MAGIC);
}

/**
 * Encrypt a UTF-8 string and return the encrypted buffer.
 */
export function encryptString(plaintext: string, key: Buffer): Buffer {
  return encrypt(Buffer.from(plaintext, "utf-8"), key).buffer;
}

/**
 * Decrypt a buffer and return the plaintext as a UTF-8 string.
 */
export function decryptString(blob: Buffer, key: Buffer): string {
  return decrypt(blob, key).toString("utf-8");
}

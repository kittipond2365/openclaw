/**
 * Encrypted file system operations for workspace files.
 *
 * Provides transparent encryption/decryption when reading and writing
 * workspace files. Detects whether a file is encrypted and handles
 * both encrypted and plaintext files gracefully (for migration).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { decrypt, encrypt, isEncrypted } from "./crypto.js";

/**
 * Read a file, decrypting it if it's encrypted.
 * Falls back to plaintext if the file isn't encrypted (migration support).
 */
export async function readFileEncrypted(filePath: string, key: Buffer | null): Promise<string> {
  const raw = await fs.readFile(filePath);

  if (isEncrypted(raw)) {
    if (!key) {
      throw new Error(
        `File is encrypted but no key provided: ${path.basename(filePath)}. ` +
          `Run "openclaw security init" to configure encryption.`,
      );
    }
    return decrypt(raw, key).toString("utf-8");
  }

  // Plaintext file — return as-is
  return raw.toString("utf-8");
}

/**
 * Write a file, encrypting it if a key is provided.
 * Creates parent directories if needed.
 */
export async function writeFileEncrypted(
  filePath: string,
  content: string,
  key: Buffer | null,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  if (key) {
    const encrypted = encrypt(Buffer.from(content, "utf-8"), key);
    await fs.writeFile(filePath, encrypted.buffer);
  } else {
    await fs.writeFile(filePath, content, "utf-8");
  }
}

/**
 * Migrate a plaintext file to encrypted format in-place.
 * No-op if the file is already encrypted.
 *
 * @returns true if migration happened, false if already encrypted or file doesn't exist
 */
export async function migrateFileToEncrypted(filePath: string, key: Buffer): Promise<boolean> {
  try {
    const raw = await fs.readFile(filePath);

    if (isEncrypted(raw)) {
      return false; // Already encrypted
    }

    const encrypted = encrypt(raw, key);
    await fs.writeFile(filePath, encrypted.buffer);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return false; // File doesn't exist
    }
    throw err;
  }
}

/**
 * Migrate an encrypted file back to plaintext format in-place.
 * No-op if the file is already plaintext.
 *
 * @returns true if migration happened, false if already plaintext or file doesn't exist
 */
export async function migrateFileToPlaintext(filePath: string, key: Buffer): Promise<boolean> {
  try {
    const raw = await fs.readFile(filePath);

    if (!isEncrypted(raw)) {
      return false; // Already plaintext
    }

    const decrypted = decrypt(raw, key);
    await fs.writeFile(filePath, decrypted);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw err;
  }
}

/**
 * Encrypt all workspace files that match the given patterns.
 * Used during initial encryption setup.
 */
export async function migrateWorkspaceToEncrypted(
  workspaceDir: string,
  key: Buffer,
  patterns: string[] = WORKSPACE_SENSITIVE_FILES,
): Promise<{
  migrated: string[];
  skipped: string[];
  errors: Array<{ file: string; error: string }>;
}> {
  const migrated: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ file: string; error: string }> = [];

  for (const pattern of patterns) {
    const filePath = path.join(workspaceDir, pattern);
    try {
      const didMigrate = await migrateFileToEncrypted(filePath, key);
      if (didMigrate) {
        migrated.push(pattern);
      } else {
        skipped.push(pattern);
      }
    } catch (err: unknown) {
      errors.push({ file: pattern, error: String(err) });
    }
  }

  return { migrated, skipped, errors };
}

/**
 * Default list of workspace files to encrypt.
 * These are the files most likely to contain sensitive information.
 */
export const WORKSPACE_SENSITIVE_FILES = [
  "MEMORY.md",
  "USER.md",
  "IDENTITY.md",
  "TOOLS.md",
  "HEARTBEAT.md",
];

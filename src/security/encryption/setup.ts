import fs from "node:fs/promises";
import path from "node:path";
import { decrypt } from "./crypto.js";
/**
 * High-level encryption setup and management orchestrator.
 *
 * Coordinates key derivation, keychain storage, file migration,
 * and metadata updates for the encryption lifecycle:
 *
 * - initEncryption: First-time setup (password → keys → encrypt files)
 * - changePassword: Re-derive keys, re-encrypt everything
 * - disableEncryption: Decrypt everything, remove keys
 * - unlockEncryption: Load keys from keychain for a session
 */
import { deriveKeys } from "./key-derivation.js";
import { keychainClearAll, keychainGetAll, keychainStoreAll } from "./keychain.js";
import { createEncryptionMeta, readEncryptionMeta, writeEncryptionMeta } from "./metadata.js";
import { migrateWorkspaceToEncrypted, WORKSPACE_SENSITIVE_FILES } from "./workspace-fs.js";

export interface SetupResult {
  success: boolean;
  migrated: string[];
  skipped: string[];
  errors: Array<{ file: string; error: string }>;
}

/**
 * Initialize encryption for a workspace.
 *
 * 1. Derives keys from password
 * 2. Stores keys in OS Keychain
 * 3. Encrypts sensitive workspace files
 * 4. Writes metadata file
 */
export async function initEncryption(
  workspaceDir: string,
  password: string,
  patterns?: string[],
): Promise<SetupResult> {
  const filePatterns = patterns ?? WORKSPACE_SENSITIVE_FILES;

  // Derive keys
  const keys = await deriveKeys(password);

  // Store in Keychain
  keychainStoreAll(keys);

  // Encrypt workspace files
  const result = await migrateWorkspaceToEncrypted(workspaceDir, keys.workspaceKey, filePatterns);

  // Write metadata
  const meta = createEncryptionMeta(keys.salt, result.migrated);
  await writeEncryptionMeta(workspaceDir, meta);

  return {
    success: result.errors.length === 0,
    migrated: result.migrated,
    skipped: result.skipped,
    errors: result.errors,
  };
}

/**
 * Change the encryption password.
 *
 * 1. Verifies old password
 * 2. Decrypts all files with old key
 * 3. Derives new keys from new password
 * 4. Re-encrypts all files with new key
 * 5. Updates Keychain and metadata
 */
export async function changePassword(
  workspaceDir: string,
  oldPassword: string,
  newPassword: string,
): Promise<SetupResult> {
  const meta = await readEncryptionMeta(workspaceDir);
  if (!meta) {
    throw new Error("Encryption is not configured for this workspace");
  }

  // Derive old keys to verify password
  const oldSalt = Buffer.from(meta.salt, "hex");
  const oldKeys = await deriveKeys(oldPassword, oldSalt);

  // Verify by trying to decrypt a file
  const verified = await verifyKey(workspaceDir, oldKeys.workspaceKey, meta.encryptedPatterns);
  if (!verified) {
    throw new Error("Incorrect password — could not decrypt workspace files");
  }

  // Decrypt all files with old key
  for (const pattern of meta.encryptedPatterns) {
    const filePath = path.join(workspaceDir, pattern);
    try {
      const raw = await fs.readFile(filePath);
      const decrypted = decrypt(raw, oldKeys.workspaceKey);
      await fs.writeFile(filePath, decrypted);
    } catch {
      // Skip files that don't exist or can't be read
    }
  }

  // Re-encrypt with new password
  const newKeys = await deriveKeys(newPassword);
  keychainStoreAll(newKeys);

  const result = await migrateWorkspaceToEncrypted(
    workspaceDir,
    newKeys.workspaceKey,
    meta.encryptedPatterns,
  );

  // Update metadata
  const newMeta = createEncryptionMeta(newKeys.salt, result.migrated);
  newMeta.createdAt = meta.createdAt; // Preserve original creation time
  await writeEncryptionMeta(workspaceDir, newMeta);

  return {
    success: result.errors.length === 0,
    migrated: result.migrated,
    skipped: result.skipped,
    errors: result.errors,
  };
}

/**
 * Disable encryption entirely.
 *
 * 1. Decrypts all files to plaintext
 * 2. Removes keys from Keychain
 * 3. Removes metadata file
 */
export async function disableEncryption(workspaceDir: string, password: string): Promise<void> {
  const meta = await readEncryptionMeta(workspaceDir);
  if (!meta) {
    return;
  }

  // Derive keys to decrypt
  const salt = Buffer.from(meta.salt, "hex");
  const keys = await deriveKeys(password, salt);

  // Decrypt all files
  for (const pattern of meta.encryptedPatterns) {
    const filePath = path.join(workspaceDir, pattern);
    try {
      const raw = await fs.readFile(filePath);
      const decrypted = decrypt(raw, keys.workspaceKey);
      await fs.writeFile(filePath, decrypted);
    } catch {
      // Skip files that don't exist
    }
  }

  // Remove keys from Keychain
  keychainClearAll();

  // Remove metadata
  try {
    await fs.unlink(path.join(workspaceDir, ".encryption-meta.json"));
  } catch {
    // Already gone
  }
}

/**
 * Load encryption keys from the Keychain for use during a session.
 * Returns null if no keys are stored (encryption not set up).
 */
export function unlockFromKeychain(): {
  workspaceKey: Buffer;
  configKey: Buffer;
} | null {
  const keys = keychainGetAll();
  if (!keys) {
    return null;
  }
  return {
    workspaceKey: keys.workspaceKey,
    configKey: keys.configKey,
  };
}

/**
 * Verify a key by attempting to decrypt the first available encrypted file.
 */
async function verifyKey(workspaceDir: string, key: Buffer, patterns: string[]): Promise<boolean> {
  for (const pattern of patterns) {
    const filePath = path.join(workspaceDir, pattern);
    try {
      const raw = await fs.readFile(filePath);
      decrypt(raw, key);
      return true;
    } catch {
      continue;
    }
  }
  // No files to verify against — assume OK
  return true;
}

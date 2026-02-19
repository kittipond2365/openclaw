/**
 * Encryption metadata file management.
 *
 * Stores a `.encryption-meta.json` file in the workspace root
 * to track encryption state: salt, enabled status, version,
 * and which files are encrypted.
 *
 * The salt is NOT secret — it's safe to store on disk.
 * The actual keys are stored in the OS Keychain.
 */
import fs from "node:fs/promises";
import path from "node:path";

const META_FILENAME = ".encryption-meta.json";

export interface EncryptionMeta {
  /** Schema version for forward compatibility */
  version: 1;
  /** Whether encryption is currently enabled */
  enabled: boolean;
  /** Salt used for key derivation (hex-encoded) */
  salt: string;
  /** Timestamp of initial encryption setup */
  createdAt: string;
  /** Timestamp of last key change */
  lastKeyChangeAt: string;
  /** List of file patterns that are encrypted */
  encryptedPatterns: string[];
}

/**
 * Read encryption metadata from the workspace.
 * Returns null if no metadata file exists (encryption not configured).
 */
export async function readEncryptionMeta(workspaceDir: string): Promise<EncryptionMeta | null> {
  const metaPath = path.join(workspaceDir, META_FILENAME);
  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    return JSON.parse(raw) as EncryptionMeta;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/**
 * Write encryption metadata to the workspace.
 */
export async function writeEncryptionMeta(
  workspaceDir: string,
  meta: EncryptionMeta,
): Promise<void> {
  const metaPath = path.join(workspaceDir, META_FILENAME);
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
}

/**
 * Create initial encryption metadata.
 */
export function createEncryptionMeta(salt: Buffer, encryptedPatterns: string[]): EncryptionMeta {
  const now = new Date().toISOString();
  return {
    version: 1,
    enabled: true,
    salt: salt.toString("hex"),
    createdAt: now,
    lastKeyChangeAt: now,
    encryptedPatterns,
  };
}

/**
 * Check if encryption is configured for the workspace.
 */
export async function isEncryptionConfigured(workspaceDir: string): Promise<boolean> {
  const meta = await readEncryptionMeta(workspaceDir);
  return meta !== null && meta.enabled;
}

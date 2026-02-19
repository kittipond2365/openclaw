/**
 * Integration guide and startup hook for workspace encryption.
 *
 * This module provides the startup initialization that loads
 * encryption keys from the Keychain and makes them available
 * for transparent decryption during file reads.
 *
 * Integration points (files that read workspace content):
 *
 * 1. src/agents/workspace.ts
 *    readFileAutoDecrypt(entry.filePath) — bootstrap file loading
 *    Affects: AGENTS.md, SOUL.md, USER.md, IDENTITY.md, TOOLS.md, HEARTBEAT.md, BOOTSTRAP.md, MEMORY.md
 *
 * 2. src/memory/manager.ts
 *    readFileAutoDecrypt(absPath) — memory_get tool
 *
 * 3. src/memory/internal.ts
 *    readFileAutoDecrypt(absPath) — memory indexing for search
 *
 * Write strategy:
 *   Agent tools write files in plaintext (no modification needed).
 *   On each startup, bootstrapEncryption() re-encrypts any plaintext
 *   files that should be encrypted, ensuring at-rest protection.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { isEncrypted } from "./crypto.js";
import { setActiveKeys } from "./fs-middleware.js";
import { keychainGetAll } from "./keychain.js";
import { isEncryptionConfigured, readEncryptionMeta } from "./metadata.js";
import { migrateFileToEncrypted } from "./workspace-fs.js";

export interface EncryptionBootstrapResult {
  enabled: boolean;
  keysLoaded: boolean;
  reEncrypted: string[];
  error?: string;
}

/**
 * Initialize encryption for the current process.
 *
 * Call this early in gateway startup, before any workspace files are read.
 * It checks if encryption is configured, loads keys from the Keychain,
 * activates them for transparent decryption, and re-encrypts any files
 * that were written in plaintext since the last startup.
 *
 * Safe to call even if encryption is not configured (no-op).
 */
export async function bootstrapEncryption(
  workspaceDir: string,
): Promise<EncryptionBootstrapResult> {
  // Check if encryption is configured
  const configured = await isEncryptionConfigured(workspaceDir);
  if (!configured) {
    return { enabled: false, keysLoaded: false, reEncrypted: [] };
  }

  // Load keys from Keychain
  const keys = keychainGetAll();
  if (!keys) {
    return {
      enabled: true,
      keysLoaded: false,
      reEncrypted: [],
      error:
        "Encryption is enabled but keys are not in the Keychain. " +
        'Run "openclaw security unlock" to enter your password.',
    };
  }

  // Activate keys for transparent decryption
  setActiveKeys(keys.workspaceKey, keys.configKey);

  // Re-encrypt any files that were written in plaintext since last startup
  const reEncrypted = await reEncryptPlaintextFiles(workspaceDir, keys.workspaceKey);

  return { enabled: true, keysLoaded: true, reEncrypted };
}

/**
 * Re-encrypt workspace files that are currently plaintext but should be encrypted.
 *
 * This handles the case where agent tools write files directly to disk
 * (bypassing encryption). On each startup, we check tracked files and
 * re-encrypt any that were written in plaintext.
 */
async function reEncryptPlaintextFiles(
  workspaceDir: string,
  workspaceKey: Buffer,
): Promise<string[]> {
  const meta = await readEncryptionMeta(workspaceDir);
  if (!meta?.encryptedPatterns) {
    return [];
  }

  const reEncrypted: string[] = [];

  // Re-encrypt tracked patterns
  for (const pattern of meta.encryptedPatterns) {
    const filePath = path.join(workspaceDir, pattern);
    try {
      const raw = await fs.readFile(filePath);
      if (!isEncrypted(raw)) {
        await migrateFileToEncrypted(filePath, workspaceKey);
        reEncrypted.push(pattern);
      }
    } catch {
      // File doesn't exist or can't be read — skip
    }
  }

  // Also check memory/ directory for any .md files that should be encrypted
  const memoryDir = path.join(workspaceDir, "memory");
  try {
    const entries = await fs.readdir(memoryDir);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) {
        continue;
      }
      const filePath = path.join(memoryDir, entry);
      try {
        const raw = await fs.readFile(filePath);
        if (!isEncrypted(raw)) {
          await migrateFileToEncrypted(filePath, workspaceKey);
          reEncrypted.push(`memory/${entry}`);
        }
      } catch {
        // Skip
      }
    }
  } catch {
    // memory/ dir doesn't exist — fine
  }

  return reEncrypted;
}

/**
 * Shutdown encryption — clear keys from memory.
 * Call during gateway shutdown.
 */
export { clearActiveKeys as shutdownEncryption } from "./fs-middleware.js";

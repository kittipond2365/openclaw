import { setActiveKeys } from "./fs-middleware.js";
import { keychainGetAll } from "./keychain.js";
/**
 * Integration guide and startup hook for workspace encryption.
 *
 * This module provides the startup initialization that loads
 * encryption keys from the Keychain and makes them available
 * for transparent decryption during file reads.
 *
 * Integration points (files that read workspace content):
 *
 * 1. src/agents/workspace.ts:454
 *    fs.readFile(entry.filePath, "utf-8") → readFileAutoDecrypt(entry.filePath)
 *    Affects: AGENTS.md, SOUL.md, USER.md, IDENTITY.md, TOOLS.md, HEARTBEAT.md, BOOTSTRAP.md, MEMORY.md
 *
 * 2. src/agents/workspace.ts:534
 *    fs.readFile(realFilePath, "utf-8") → readFileAutoDecrypt(realFilePath)
 *    Affects: Extra bootstrap files
 *
 * 3. src/memory/manager.ts:444
 *    fs.readFile(absPath, "utf-8") → readFileAutoDecrypt(absPath)
 *    Affects: memory_get tool (reading memory files)
 *
 * 4. src/memory/internal.ts:156
 *    fs.readFile(absPath, "utf-8") → readFileAutoDecrypt(absPath)
 *    Affects: Memory indexing / search
 *
 * 5. src/config/io.ts:544,662
 *    deps.fs.readFileSync(configPath, "utf-8") → readConfigSyncAutoDecrypt(configPath)
 *    Affects: config.yaml loading (uses configKey, not workspaceKey)
 */
import { isEncryptionConfigured } from "./metadata.js";

export interface EncryptionBootstrapResult {
  enabled: boolean;
  keysLoaded: boolean;
  error?: string;
}

/**
 * Initialize encryption for the current process.
 *
 * Call this early in gateway startup, before any workspace files are read.
 * It checks if encryption is configured, loads keys from the Keychain,
 * and activates them for transparent decryption.
 *
 * Safe to call even if encryption is not configured (no-op).
 */
export async function bootstrapEncryption(
  workspaceDir: string,
): Promise<EncryptionBootstrapResult> {
  // Check if encryption is configured
  const configured = await isEncryptionConfigured(workspaceDir);
  if (!configured) {
    return { enabled: false, keysLoaded: false };
  }

  // Load keys from Keychain
  const keys = keychainGetAll();
  if (!keys) {
    return {
      enabled: true,
      keysLoaded: false,
      error:
        "Encryption is enabled but keys are not in the Keychain. " +
        'Run "openclaw security unlock" to enter your password.',
    };
  }

  // Activate keys for transparent decryption
  setActiveKeys(keys.workspaceKey, keys.configKey);

  return { enabled: true, keysLoaded: true };
}

/**
 * Shutdown encryption — clear keys from memory.
 * Call during gateway shutdown.
 */
export { clearActiveKeys as shutdownEncryption } from "./fs-middleware.js";

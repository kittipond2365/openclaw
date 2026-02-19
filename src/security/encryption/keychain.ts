/**
 * macOS Keychain integration via the `security` CLI.
 *
 * Stores encryption keys in the system keychain so they survive reboots
 * without requiring the user to re-enter their password each time.
 *
 * Future: add Windows Credential Manager and Linux secret-service support.
 */
import { execFileSync } from "node:child_process";
import os from "node:os";

const SERVICE_NAME = "ai.openclaw.encryption";

export type KeychainAccount = "workspace-key" | "config-key" | "encryption-salt";

/**
 * Store a value in the macOS Keychain.
 * Overwrites if the entry already exists.
 */
export function keychainSet(account: KeychainAccount, value: Buffer): void {
  assertMacOS();

  // Delete existing entry first (security CLI errors on duplicate)
  try {
    keychainDelete(account);
  } catch {
    // Entry doesn't exist yet — fine
  }

  const hex = value.toString("hex");
  execFileSync(
    "security",
    [
      "add-generic-password",
      "-a",
      account,
      "-s",
      SERVICE_NAME,
      "-w",
      hex,
      "-U", // update if exists (belt + suspenders)
    ],
    { stdio: "pipe" },
  );
}

/**
 * Retrieve a value from the macOS Keychain.
 * Returns null if the entry doesn't exist.
 */
export function keychainGet(account: KeychainAccount): Buffer | null {
  assertMacOS();

  try {
    const hex = execFileSync(
      "security",
      [
        "find-generic-password",
        "-a",
        account,
        "-s",
        SERVICE_NAME,
        "-w", // output password only
      ],
      { stdio: "pipe", encoding: "utf-8" },
    ).trim();

    return Buffer.from(hex, "hex");
  } catch {
    return null;
  }
}

/**
 * Delete an entry from the macOS Keychain.
 */
export function keychainDelete(account: KeychainAccount): void {
  assertMacOS();

  execFileSync("security", ["delete-generic-password", "-a", account, "-s", SERVICE_NAME], {
    stdio: "pipe",
  });
}

/**
 * Check if all encryption keys are stored in the Keychain.
 */
export function keychainHasKeys(): boolean {
  return (
    keychainGet("workspace-key") !== null &&
    keychainGet("config-key") !== null &&
    keychainGet("encryption-salt") !== null
  );
}

/**
 * Store all derived keys + salt in the Keychain.
 */
export function keychainStoreAll(keys: {
  workspaceKey: Buffer;
  configKey: Buffer;
  salt: Buffer;
}): void {
  keychainSet("workspace-key", keys.workspaceKey);
  keychainSet("config-key", keys.configKey);
  keychainSet("encryption-salt", keys.salt);
}

/**
 * Retrieve all keys from the Keychain.
 * Returns null if any key is missing.
 */
export function keychainGetAll(): {
  workspaceKey: Buffer;
  configKey: Buffer;
  salt: Buffer;
} | null {
  const workspaceKey = keychainGet("workspace-key");
  const configKey = keychainGet("config-key");
  const salt = keychainGet("encryption-salt");

  if (!workspaceKey || !configKey || !salt) {
    return null;
  }

  return { workspaceKey, configKey, salt };
}

/**
 * Remove all encryption keys from the Keychain.
 */
export function keychainClearAll(): void {
  for (const account of ["workspace-key", "config-key", "encryption-salt"] as const) {
    try {
      keychainDelete(account);
    } catch {
      // Already deleted or never existed
    }
  }
}

function assertMacOS(): void {
  if (os.platform() !== "darwin") {
    throw new Error(
      "Keychain integration is currently macOS-only. Windows and Linux support coming in Phase 3.",
    );
  }
}

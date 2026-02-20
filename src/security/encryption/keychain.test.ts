import crypto from "node:crypto";
import os from "node:os";
import { describe, expect, it, vi } from "vitest";

// Mock child_process and os to avoid touching real keychain
vi.mock("node:child_process", () => {
  const store = new Map<string, string>();
  return {
    execFileSync: (cmd: string, args: string[], _opts?: unknown) => {
      if (cmd !== "security") {
        throw new Error(`unexpected command: ${cmd}`);
      }
      const subcommand = args[0];

      if (subcommand === "add-generic-password") {
        const account = args[args.indexOf("-a") + 1];
        const service = args[args.indexOf("-s") + 1];
        const password = args[args.indexOf("-w") + 1];
        store.set(`${service}:${account}`, password);
        return "";
      }

      if (subcommand === "find-generic-password") {
        const account = args[args.indexOf("-a") + 1];
        const service = args[args.indexOf("-s") + 1];
        const key = `${service}:${account}`;
        if (!store.has(key)) {
          throw new Error(
            "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.",
          );
        }
        return store.get(key)! + "\n";
      }

      if (subcommand === "delete-generic-password") {
        const account = args[args.indexOf("-a") + 1];
        const service = args[args.indexOf("-s") + 1];
        const key = `${service}:${account}`;
        if (!store.has(key)) {
          throw new Error(
            "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.",
          );
        }
        store.delete(key);
        return "";
      }

      throw new Error(`unexpected subcommand: ${subcommand}`);
    },
  };
});

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof os>("node:os");
  return {
    ...actual,
    default: {
      ...actual,
      platform: () => "darwin",
    },
    platform: () => "darwin",
  };
});

// Must import after mocks are set up
const {
  keychainSet,
  keychainGet,
  keychainDelete,
  keychainHasKeys,
  keychainStoreAll,
  keychainGetAll,
  keychainClearAll,
} = await import("./keychain.js");

describe("keychain (mocked)", () => {
  it("stores and retrieves a key", () => {
    const key = crypto.randomBytes(32);
    keychainSet("workspace-key", key);
    const retrieved = keychainGet("workspace-key");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.equals(key)).toBe(true);
  });

  it("returns null for missing key", () => {
    expect(keychainGet("config-key")).toBeNull();
  });

  it("deletes a key", () => {
    const key = crypto.randomBytes(32);
    keychainSet("workspace-key", key);
    keychainDelete("workspace-key");
    expect(keychainGet("workspace-key")).toBeNull();
  });

  it("keychainHasKeys returns false when incomplete", () => {
    keychainClearAll();
    expect(keychainHasKeys()).toBe(false);
  });

  it("keychainStoreAll and keychainGetAll round-trip", () => {
    const keys = {
      workspaceKey: crypto.randomBytes(32),
      configKey: crypto.randomBytes(32),
      salt: crypto.randomBytes(32),
    };
    keychainStoreAll(keys);
    expect(keychainHasKeys()).toBe(true);

    const retrieved = keychainGetAll();
    expect(retrieved).not.toBeNull();
    expect(retrieved!.workspaceKey.equals(keys.workspaceKey)).toBe(true);
    expect(retrieved!.configKey.equals(keys.configKey)).toBe(true);
    expect(retrieved!.salt.equals(keys.salt)).toBe(true);
  });

  it("keychainClearAll removes everything", () => {
    const keys = {
      workspaceKey: crypto.randomBytes(32),
      configKey: crypto.randomBytes(32),
      salt: crypto.randomBytes(32),
    };
    keychainStoreAll(keys);
    keychainClearAll();
    expect(keychainHasKeys()).toBe(false);
    expect(keychainGetAll()).toBeNull();
  });
});

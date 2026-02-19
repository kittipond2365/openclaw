/**
 * Workspace encryption module.
 *
 * Provides AES-256-GCM encryption for workspace files and config,
 * with macOS Keychain key storage and scrypt key derivation.
 *
 * Usage:
 *   import { encrypt, decrypt, isEncrypted } from "./encryption/crypto.js";
 *   import { deriveKeys } from "./encryption/key-derivation.js";
 *   import { keychainStoreAll, keychainGetAll } from "./encryption/keychain.js";
 *   import { readFileEncrypted, writeFileEncrypted } from "./encryption/workspace-fs.js";
 */
export { decrypt, decryptString, encrypt, encryptString, isEncrypted } from "./crypto.js";
export type { EncryptedBlob } from "./crypto.js";
export { deriveKeys, generateSalt } from "./key-derivation.js";
export type { DerivedKeys } from "./key-derivation.js";
export {
  keychainClearAll,
  keychainDelete,
  keychainGet,
  keychainGetAll,
  keychainHasKeys,
  keychainSet,
  keychainStoreAll,
} from "./keychain.js";
export type { KeychainAccount } from "./keychain.js";
export {
  migrateFileToEncrypted,
  migrateFileToPlaintext,
  migrateWorkspaceToEncrypted,
  readFileEncrypted,
  WORKSPACE_SENSITIVE_FILES,
  writeFileEncrypted,
} from "./workspace-fs.js";
export {
  createEncryptionMeta,
  isEncryptionConfigured,
  readEncryptionMeta,
  writeEncryptionMeta,
} from "./metadata.js";
export type { EncryptionMeta } from "./metadata.js";
export { changePassword, disableEncryption, initEncryption, unlockFromKeychain } from "./setup.js";
export type { SetupResult } from "./setup.js";

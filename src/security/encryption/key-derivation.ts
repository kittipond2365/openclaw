/**
 * Key derivation using Node's built-in scrypt (memory-hard KDF).
 *
 * Derives two independent 256-bit keys from a single password:
 * - workspaceKey: encrypts workspace files (MEMORY.md, SOUL.md, etc.)
 * - configKey: encrypts config.yaml and credentials
 *
 * Separate keys limit blast radius — compromising one doesn't expose the other.
 */
import crypto from "node:crypto";

/** scrypt parameters — tuned for security on modern hardware */
const SCRYPT_PARAMS = {
  N: 2 ** 17, // CPU/memory cost (128 KB * 131072 = 16 GB memory)
  r: 8, // block size
  p: 1, // parallelization
  maxmem: 256 * 1024 * 1024, // 256 MB max memory for scrypt
};

const SALT_LENGTH = 32;
const KEY_LENGTH = 32; // 256 bits

/** Info strings for HKDF-like domain separation via scrypt */
const WORKSPACE_INFO = "openclaw-workspace-key-v1";
const CONFIG_INFO = "openclaw-config-key-v1";

export interface DerivedKeys {
  workspaceKey: Buffer;
  configKey: Buffer;
  salt: Buffer;
}

/**
 * Derive workspace and config keys from a password.
 *
 * @param password - User's master password
 * @param salt - Optional salt (generated if not provided, e.g. first-time setup)
 * @returns DerivedKeys with both keys and the salt (store salt for re-derivation)
 */
export async function deriveKeys(password: string, salt?: Buffer): Promise<DerivedKeys> {
  const effectiveSalt = salt ?? crypto.randomBytes(SALT_LENGTH);

  // Derive two keys with different salts (domain separation)
  const [workspaceKey, configKey] = await Promise.all([
    scryptAsync(password, Buffer.concat([effectiveSalt, Buffer.from(WORKSPACE_INFO)]), KEY_LENGTH),
    scryptAsync(password, Buffer.concat([effectiveSalt, Buffer.from(CONFIG_INFO)]), KEY_LENGTH),
  ]);

  return {
    workspaceKey,
    configKey,
    salt: effectiveSalt,
  };
}

/**
 * Generate a random salt for key derivation.
 */
export function generateSalt(): Buffer {
  return crypto.randomBytes(SALT_LENGTH);
}

/**
 * Promise wrapper around crypto.scrypt.
 */
function scryptAsync(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keyLength, SCRYPT_PARAMS, (err, key) => {
      if (err) {
        reject(err);
      } else {
        resolve(key);
      }
    });
  });
}

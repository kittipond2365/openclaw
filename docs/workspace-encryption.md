# Workspace Encryption

Encrypt your OpenClaw workspace files at rest using AES-256-GCM encryption with keys stored in the macOS Keychain.

## Quick Start

```bash
# Enable encryption
openclaw security init

# Check status
openclaw security status

# Change password
openclaw security change-password

# Disable encryption
openclaw security disable
```

## How It Works

### Two-Key Architecture

OpenClaw uses two separate encryption keys, derived from a single master password:

| Key               | Protects                                                              | Purpose                       |
| ----------------- | --------------------------------------------------------------------- | ----------------------------- |
| **Workspace Key** | MEMORY.md, USER.md, IDENTITY.md, TOOLS.md, HEARTBEAT.md, memory/\*.md | Sensitive agent context       |
| **Config Key**    | config.yaml                                                           | API keys, tokens, credentials |

Separating keys limits blast radius — compromising one key doesn't expose the other.

### Key Derivation

Keys are derived using **scrypt** (built into Node.js):

- **Parameters:** N=131072, r=8, p=1
- **Salt:** 32 random bytes (stored in `.encryption-meta.json`)
- **Output:** Two 256-bit keys via domain separation

The salt is not secret — it's safe to store on disk. The password never leaves your machine.

### Key Storage

Keys are stored in the **macOS Keychain** under service `ai.openclaw.encryption`:

- `workspace-key` — Hex-encoded workspace encryption key
- `config-key` — Hex-encoded config encryption key
- `encryption-salt` — Hex-encoded derivation salt

You can view them in Keychain Access.app under "login" keychain.

### File Format

Encrypted files use a custom binary format:

```
[6 bytes: "OCENC\x01" magic header]
[12 bytes: random nonce/IV]
[variable: AES-256-GCM ciphertext]
[16 bytes: authentication tag]
```

The magic header allows instant detection of encrypted vs. plaintext files without attempting decryption.

### Read Path

When OpenClaw reads a workspace file:

1. Check for `OCENC` magic header
2. If encrypted: decrypt with workspace key from memory
3. If plaintext: read as-is (backward compatible)

This means encrypted and plaintext files can coexist during migration.

### Write Path

Agent tools (write, edit) write files in **plaintext**. This is intentional:

- Avoids modifying third-party tool libraries
- Keeps the write path simple and fast
- Files are re-encrypted on next gateway startup

On each startup, `bootstrapEncryption()` scans tracked files and re-encrypts any that were written in plaintext.

## Encrypted Files

By default, these workspace files are encrypted:

- `MEMORY.md` — Long-term agent memory
- `USER.md` — User profile information
- `IDENTITY.md` — Agent identity
- `TOOLS.md` — Tool configuration and notes
- `HEARTBEAT.md` — Heartbeat configuration
- `memory/*.md` — Daily memory files

## Metadata

Encryption state is tracked in `.encryption-meta.json`:

```json
{
  "version": 1,
  "enabled": true,
  "salt": "hex-encoded-salt",
  "createdAt": "2026-02-19T00:00:00.000Z",
  "lastKeyChangeAt": "2026-02-19T00:00:00.000Z",
  "encryptedPatterns": ["MEMORY.md", "USER.md", "IDENTITY.md"]
}
```

This file is **not encrypted** — it only contains the salt (which is not secret) and file tracking information.

## Security Considerations

### What's Protected

- ✅ Files at rest on disk (encrypted)
- ✅ Keys in OS keychain (protected by login password)
- ✅ Tampered files detected (GCM authentication)

### What's NOT Protected

- ❌ Files in memory during runtime (decrypted for use)
- ❌ Files briefly plaintext after agent writes (until next restart)
- ❌ `.encryption-meta.json` (contains salt, not secret)
- ❌ AGENTS.md, SOUL.md, BOOTSTRAP.md (not encrypted by default — they contain instructions, not secrets)

### Threat Model

This protects against:

- **Disk theft** — Encrypted files are unreadable without the password
- **Backup exposure** — Encrypted backups don't leak secrets
- **Unauthorized file access** — Other users on the machine can't read workspace files

This does NOT protect against:

- **Root/admin access** — Can read process memory
- **Keyloggers** — Can capture the password
- **Active compromise** — Attacker with code execution on the machine

## Platform Support

| Platform | Status                                  |
| -------- | --------------------------------------- |
| macOS    | ✅ Supported (Keychain)                 |
| Linux    | 🔜 Planned (secret-service / libsecret) |
| Windows  | 🔜 Planned (Credential Manager)         |

## Dependencies

**Zero new dependencies.** Uses only Node.js built-in modules:

- `node:crypto` — AES-256-GCM encryption, scrypt key derivation
- `child_process` — macOS `security` CLI for Keychain access

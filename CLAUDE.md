# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build & Type Checking

```bash
pnpm install              # Install dependencies
pnpm build                # Full build (canvas bundle, tsdown, plugin SDK, copy assets)
pnpm tsgo                 # TypeScript type checking
```

### Testing

```bash
pnpm test                 # Run all unit tests in parallel
pnpm test:fast            # Run unit tests (vitest.unit.config.ts)
pnpm test:e2e             # Run end-to-end tests
pnpm test:live            # Run live tests (requires API keys)
pnpm test:coverage        # Run tests with coverage
pnpm test:watch           # Run tests in watch mode

# Test individual file
vitest run path/to/file.test.ts
```

### Linting & Formatting

```bash
pnpm check                # Run format check, tsgo, and lint
pnpm format               # Format check (oxfmt)
pnpm format:fix           # Auto-fix formatting (oxfmt --write)
pnpm lint                 # Lint (oxlint --type-aware)
pnpm lint:fix             # Auto-fix lint issues and format
```

### Development Workflow

```bash
pnpm openclaw ...         # Run CLI in dev mode
pnpm dev                  # Run with dev watcher
pnpm gateway:watch        # Watch mode for gateway
pnpm tui:dev              # Run TUI in dev mode
```

### Restarting the Dev Gateway

Always use this exact command to start/restart the dev gateway. Do not use `pnpm gateway:dev` or improvise alternatives.

```bash
cd /Users/ada/repos/openclaw-fork
nohup env OPENCLAW_STATE_DIR=/Users/ada/.openclaw-dev node scripts/run-node.mjs gateway --force --port 18889 run > /tmp/openclaw-dev-gateway.log 2>&1 &
```

Check startup with: `tail -10 /tmp/openclaw-dev-gateway.log`

### UI Development

```bash
pnpm ui:install           # Install UI dependencies
pnpm ui:dev               # Run UI dev server
pnpm ui:build             # Build UI
```

## High-Level Architecture

OpenClaw is a **multi-channel AI gateway** that routes messages from various messaging platforms (WhatsApp, Telegram, Discord, Slack, Signal, etc.) to AI agents powered by the Pi Agent runtime.

### Core Components

#### 1. Gateway (`src/gateway/`)

The central orchestration engine that:

- Runs a WebSocket + HTTP server for control plane communication
- Manages channel lifecycles (start/stop/restart with backoff)
- Routes gateway method calls (agent, chat, sessions, models, cron, etc.)
- Handles session management and persistence
- Coordinates between channels and agents

Key files:

- `server.impl.ts`: Main gateway server implementation
- `server-http.ts`: HTTP/WebSocket server setup
- `server-methods/*.ts`: Gateway RPC methods organized by domain
- `server-channels.ts`: Channel lifecycle management

#### 2. Routing (`src/routing/`)

Message routing logic that determines which agent handles which message:

- Routes based on channel + peer + account + guild roles
- Generates deterministic session keys for persistence
- Implements binding fallback chains (peer → parent → guild+roles → team → account → channel → default)

Key file: `resolve-route.ts`

#### 3. Channel Integration (`src/channels/`)

Plugin-based architecture for messaging platforms:

- Each channel is a plugin implementing optional adapters:
  - `ChannelMessagingAdapter`: Inbound/outbound messages
  - `ChannelAuthAdapter`: Auth/login flows
  - `ChannelGatewayAdapter`: Lifecycle hooks
  - `ChannelSecurityAdapter`: DM policies, allowlists
  - `ChannelOutboundAdapter`: Message delivery with threading/reactions
  - Plus specialized adapters for heartbeats, mentions, commands, streaming, actions

Core channels in `src/`: `discord/`, `telegram/`, `slack/`, `signal/`, `imessage/`, `web/`, `whatsapp/`

Extension channels in `extensions/`: `matrix/`, `msteams/`, `zalo/`, `voice-call/`, etc.

Key files:

- `plugins/types.plugin.ts`: Channel plugin interface
- `plugins/index.ts`: Channel registry
- `dock.ts`: Lightweight interface for reply flows

#### 4. Agent Runtime (`src/agents/`)

Wraps the Pi Agent Core for AI inference:

- Spawns and manages agent instances with workspace isolation
- Resolves model configs and handles auth profiles
- Provides tool system bridging gateway capabilities to agent tools
- Handles OAuth/API key rotation and failover

Key files:

- `agent-scope.ts`: Agent spawning and workspace management
- `models-config.ts`: Model routing and provider discovery
- `tools/`: Tool definitions (browser, canvas, node commands)
- `auth-profiles/`: Multi-profile auth management

#### 5. Plugin System (`src/plugins/`)

Runtime plugin discovery and loading:

- Discovers plugins from: bundled (core), npm packages, workspace, git repos
- Plugin types: channels, providers, tools, memory, hooks
- Plugins declare capabilities via manifests (tools, hooks, commands, routes, config schema)

Key files:

- `registry.ts`: Plugin discovery and registration
- `loader.ts`: Plugin loading from multiple sources
- `manifest.ts`: Plugin capability declarations
- `hooks.ts`: Gateway lifecycle hooks integration

#### 6. CLI (`src/cli/`)

Command-line interface layer:

- Commander.js-based CLI with subcommands
- Interactive onboarding wizard for setup
- Session management and profile switching (dev/production)

Key files:

- `program.ts`, `run-main.ts`: Command dispatch
- `wizard/`: Onboarding wizard
- `profile.ts`: Environment profile management

### Message Flow

```
Inbound Message Flow:
┌─────────────────────────────────────────────┐
│ 1. Raw message from channel (Discord, etc.) │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ 2. ChannelMessagingAdapter.receive()        │
│    - Normalize message (sender, text, etc.) │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ 3. Route Resolution (resolve-route.ts)      │
│    - Determine which agent handles message  │
│    - Generate session key                   │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ 4. Session Lookup/Create                    │
│    - Retrieve or create conversation context│
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ 5. Agent Invocation (Pi Agent Runtime)      │
│    - Execute agent with tools & context     │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ 6. ChannelOutboundAdapter.send()            │
│    - Format response for channel            │
│    - Handle threading, reactions, media     │
└─────────────────────────────────────────────┘
```

### Plugin Architecture

Plugins extend OpenClaw via a consistent contract:

**Channel Plugin Structure:**

```
ChannelId → ChannelMeta (name, order, capabilities)
         → ChannelCapabilities (what it can do)
         → Adapters (messaging, auth, security, etc.)
         → ConfigSchema (config validation)
         → AgentTools (channel commands)
```

**Plugin Discovery:**

1. Scan `extensions/` for npm-style packages
2. Load `package.json` with `"openclaw": { "extensions": [...] }`
3. Plugins export channel definitions or provider auth
4. Registry deduplicates and orders channels

**Plugin Loading Order:**

1. Built-in plugins (bundled)
2. NPM package plugins
3. Workspace/custom plugins
4. Wire hooks into gateway lifecycle

### Build System

**Primary Tool: tsdown**

- Compiles TypeScript entry points to optimized JS bundles
- Outputs to `dist/`
- Generates plugin SDK with `.d.ts` files

**Build Pipeline:**

```bash
pnpm build:
  1. pnpm canvas:a2ui:bundle  # Bundle A2UI renderer for Live Canvas
  2. tsdown                   # TS → JS compilation
  3. pnpm build:plugin-sdk:dts # Generate .d.ts files
  4. scripts/write-plugin-sdk-entry-dts.ts
  5. scripts/canvas-a2ui-copy.ts
  6. scripts/copy-hook-metadata.ts
  7. scripts/copy-export-html-templates.ts
  8. scripts/write-build-info.ts
  9. scripts/write-cli-compat.ts
```

**Other Build Components:**

- **A2UI Canvas**: Lit-based renderer bundled via `scripts/bundle-a2ui.sh`
- **Control UI**: Vite-built web dashboard (`ui/`)
- **Plugin SDK**: Public API at `dist/plugin-sdk/` for extension authors
- **Hooks**: Bundled separately for lazy loading

### Configuration

**Config Structure (`config.json`):**

- `agents`: Agent definitions with model configs, tools, hooks
- `channels`: Per-channel config (allowlists, DM policies)
- `models`: Provider auth, model selection, fallbacks
- `memory`: Memory plugin selection
- `skills`: Skill configs
- `cron`: Scheduled tasks

**Config Sources (priority order):**

1. CLI flags
2. Environment variables (`OPENCLAW_*`)
3. `config.json` (hot-reloaded)
4. Defaults from schema

**State Storage:**

- User config: `~/.openclaw/`
- Agent workspaces: Per-agent directories
- Session history: Agent session logs
- Channel state: In-memory (lost on restart)

## Key Design Patterns

1. **Plugin Registry Pattern**: Centralized plugin discovery and loading
2. **Adapter Pattern**: Channels implement optional interfaces; gateway calls at boundaries
3. **Lifecycle Hooks**: Extensibility without modifying core
4. **Route Resolution**: Multi-stage binding with fallback chains
5. **Lazy Loading**: Heavy modules only imported when needed
6. **Config-Driven Behavior**: Runtime behavior controlled by config
7. **Backoff & Retry**: Exponential backoff for channel restarts
8. **Approval Workflows**: Explicit approval for dangerous operations

## Important Coding Conventions

### TypeScript Style

- **Strict typing**: Avoid `any`, prefer explicit types
- **No `@ts-nocheck`**: Fix root causes instead
- **No prototype mutation**: Use explicit inheritance/composition
  - Don't use `applyPrototypeMixins`, `Object.defineProperty` on prototypes
  - Use `A extends B extends C` or helper composition
- **ESM modules**: Use `import`/`export`, not CommonJS
- **Node.js 22+**: Required runtime

### Testing

- **Colocated tests**: Place `*.test.ts` next to source files
- **E2E tests**: Use `*.e2e.test.ts` suffix
- **Live tests**: Mark with `.live.test.ts` (requires API keys)
- **Framework**: Vitest with V8 coverage (70% threshold)
- **Run before push**: `pnpm test` when changing logic

### Code Organization

- **File length**: Keep under ~500-700 LOC when feasible
- **Extract helpers**: Don't create "V2" copies of functions
- **Brief comments**: Add for tricky/non-obvious logic
- **Avoid over-engineering**: Don't add features/abstractions beyond requirements

### Tool Schemas

- **No `Type.Union`**: Avoid `anyOf`/`oneOf`/`allOf` in tool schemas
- **Use `stringEnum`**: For string enums, not `Type.Union`
- **Top-level object**: Tool schemas must be `type: "object"` with `properties`
- **No `format` keyword**: Some validators reject it

### Channel Development

When adding/modifying channels:

- Update **all** channel surfaces (macOS app, web UI, mobile, docs)
- Update channel lists and configuration forms
- Test pairing, allowlists, DM policies, and group behavior
- Consider impact on all 39+ channels (built-in + extensions)

### Formatting & Linting

- **Oxlint + Oxfmt**: Run `pnpm check` before commits
- **Auto-fix**: `pnpm lint:fix` for quick fixes
- **No hardcoded colors**: Use shared palette in `src/terminal/palette.ts`

## Common Gotchas

### Control UI Decorators

The Control UI uses **legacy decorators** (not standard decorators):

```ts
@state() foo = "bar";
@property({ type: Number }) count = 0;
```

Don't flip to standard decorators unless updating build tooling.

### Multi-Agent Safety

- **Don't create/drop git stashes** unless explicitly requested
- **Don't switch branches** unless explicitly requested
- **Don't modify worktrees** unless explicitly requested
- **Scope commits**: Only commit your changes, not other agents' work
- **Auto-resolve formatting**: If diffs are formatting-only, auto-stage

### macOS-Specific

- Gateway runs as menubar app (not LaunchAgent)
- Restart via `scripts/restart-mac.sh` or Mac app
- Logs: `scripts/clawlog.sh` for unified logs
- No rebuilds over SSH; rebuild directly on Mac

### Dependencies

- **Never edit `node_modules`**: Updates will overwrite
- **Exact versions for patches**: If `pnpm.patchedDependencies` exists, use exact version (no `^`/`~`)
- **Patching requires approval**: Don't add patches/overrides without explicit permission
- **Never update Carbon dependency**: Frozen upstream

### Release & Versioning

- **Version locations**: `package.json`, `apps/*/build.gradle.kts`, `apps/*/Info.plist`, docs
- **No appcast changes**: Only touch when cutting macOS Sparkle release
- **Restart mobile apps**: "Restart" means rebuild + relaunch, not just relaunch

## Quick Navigation

### Understanding Message Routing

Start here: `src/routing/resolve-route.ts`

### Understanding Channels

1. Channel plugin types: `src/channels/plugins/types.plugin.ts`
2. Example channel: `extensions/discord/index.ts`
3. Channel lifecycle: `src/gateway/server-channels.ts`

### Understanding Agents

1. Agent spawning: `src/agents/agent-scope.ts`
2. Model routing: `src/agents/models-config.ts`
3. Tool system: `src/agents/tools/`

### Understanding Plugins

1. Plugin registry: `src/plugins/registry.ts`
2. Plugin SDK exports: `src/plugin-sdk/index.ts`
3. Hook system: `src/plugins/hooks.ts`

### Understanding Gateway

1. Server implementation: `src/gateway/server.impl.ts`
2. Gateway methods: `src/gateway/server-methods/`
3. Session utils: `src/gateway/session-utils.ts`

## Documentation

- **Main docs**: https://docs.openclaw.ai
- **Internal doc links**: Use root-relative paths without `.md`/`.mdx` (e.g., `[Config](/configuration)`)
- **Mintlify-specific**: Avoid em dashes and apostrophes in headings (breaks anchor links)
- **README links**: Use absolute URLs (e.g., `https://docs.openclaw.ai/...`)
- **Generic content**: No personal device names/paths in docs

## Testing Checklist

Before submitting code:

1. `pnpm check` (format + lint + typecheck)
2. `pnpm build` (ensure build passes)
3. `pnpm test` (run tests)
4. Test locally with your OpenClaw instance
5. Keep PRs focused (one thing per PR)

# Graf v0.2.0 implementation status against PRD v0.2

## Implemented and covered by automated tests

- Local initialization, startup reconciliation, `.gitignore` / `.grafignore` filtering and incremental SHA-256 indexing.
- JS/TS, Python, Java, C# and Go heuristic symbol extraction; config key extraction for YAML/TOML and safe `.env.example` / `.env.sample` / `.env.template` files.
- Files, classes, functions, route declarations, potential model declarations, import/call/handler relationships and provenance/confidence metadata.
- SQLite state store using `node:sqlite`, normalized projection tables and FTS5 node search when supported; atomic JSON mirror and JSON fallback.
- Stable file/symbol IDs, summary locks, stale parse preservation, bounded change log and path containment for source access.
- Polling watcher, startup reconcile and incremental sync.
- MCP stdio JSON-RPC server, initialize instructions, `graf://overview` resource and exactly twelve tools from PRD v0.2.
- MCP argument validation, bounded outputs, source reads, overview, search, neighbors, impact and token-budgeted context.
- Human notes, memories, pins, hidden nodes, summary overrides, custom edges, aliases, architecture groups and human-layer JSON export/import preview.
- Agent-created memories default to pending; proposals are review-only and secret-scanned. Human approval is performed through CLI.
- Snapshot version chain, node/edge diff, full/human/module restore with safety snapshots, automatic hourly-on-change snapshots and commit snapshots detected during sync.
- Git branch graph isolation, per-branch graph/history state, commit metadata and local Git exclude for `.graf/`.
- CLI commands for initialization, indexing, status, query, source read, notes, memory lifecycle, pins, human edits, snapshots, diffs, restore, import/export, pointer generation, MCP serve and watch.
- VS Code extension: Explorer tree, graph webview, source navigation, notes, pins, impact view, snapshots/history, status bar and workspace MCP setup for VS Code/Cursor.
- Secret-file exclusion; secret-like content is blocked from human/agent notes, memories and proposals. Safe env templates store key names only, never values.
- Optional `AGENTS.md` / `CLAUDE.md` pointer block generation, updated idempotently.

## Automated verification

`npm test`: **10 tests passing** on Node.js 22.16.0. Tests cover parser extraction, ignore rules, indexing, snapshots/restores, MCP handshake/tool count, parser language coverage, pending agent memories, invalid MCP arguments, SQLite projections, env secret handling and Git branch isolation.

Syntax checks pass for the CLI, engine, parser, store, MCP server and VS Code extension. CLI and MCP stdio smoke tests are run during release packaging.

## Deliberate limitations

- Parsers are dependency-free lexical/regex parsers, not Tree-sitter WASM grammars. They do not provide compiler-grade parsing, exact type resolution or guaranteed correctness on every syntax construct.
- Route/model extraction is heuristic and currently focuses on recognizable JavaScript/TypeScript patterns.
- Rename/move detection and ambiguous structural identity matching are not implemented; path and qualified-name IDs are used.
- LLM summaries, HTTP MCP transport, daemon socket, resource update notifications, Git hooks, scheduled retention pruning, per-node history browsing, selective edge-only restore, activity lens and token savings meter are not implemented.
- The VS Code graph view is a bounded lightweight renderer, not a full Cytoscape/D3-grade interactive analysis surface. Marketplace packaging and publishing are not included.
- The benchmark harness and PRD performance targets have not been measured. No token-savings or throughput claims are made.

These limits are documented rather than disguising heuristic behavior as verified compiler output.

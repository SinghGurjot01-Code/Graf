## 0.2.4

- Fixed cross-process state synchronization between long-running MCP servers and CLI commands.
- Added a per-project write lock and three-way state merging to prevent stale watcher saves from reverting external memory approvals.
- Refresh persisted graph state before MCP tool calls so live agents see CLI changes immediately.
- Added regression coverage for CLI approval while an MCP process remains running.

## 0.2.3
- Fixed `get_context` result serialization and added token-budget/truncation regression coverage.
- Merged duplicate CLI memory handlers so list, approve, archive and delete commands are reachable.
- Added explicit memory approval and archive lifecycle methods; pending memories remain hidden until human approval.
- Memory listing now includes pending, active and archived records while excluding soft-deleted records.
- Added CLI and MCP integration tests for context retrieval and memory lifecycle.

## 0.2.2
- Hardened SQLite close lifecycle and CLI shutdown cleanup.
- MCP stdio loop now cleans up on EOF and reports Graf 0.2.2.
- Windows installer now stops if tests or syntax checks fail.
- Added regression coverage for idempotent database close.

# Changelog

## 0.2.0

- Added SQLite-backed state and indexed projections with JSON recovery mirror.
- Added Python, Java, C# and Go lexical extraction, route/config nodes and provenance.
- Added branch-isolated graph state, memory lifecycle and human graph editing commands.
- Added scoped restore, edge diffs, pointer generation and MCP argument validation.
- Expanded the VS Code extension with status, impact, pin, history and MCP setup commands.
- Added integration tests for SQLite, env-file secret handling and Git branch isolation.

## 0.1.0

- Initial runnable Graf core, CLI, MCP server, JSON graph store and VS Code extension.

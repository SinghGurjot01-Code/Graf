# Graf v0.2.0

**A local-first, editable, versioned project graph for MCP clients.** Graf indexes a repository into a compact graph of files, symbols, routes, configuration keys and relationships. Agents query the graph instead of repeatedly exploring the entire codebase.

- Local by default. No telemetry and no network calls.
- Node.js 22.5+; no third-party runtime dependencies.
- SQLite primary store through `node:sqlite`, with a readable JSON mirror and JSON fallback.
- Twelve bounded MCP tools, plus the `graf://overview` resource and connection instructions.
- Human-owned memory and graph overlays survive re-indexing.

## Quick start

```bash
# from the Graf folder
npm test
npm link

# from any repository
graf init
graf status
graf overview --depth 1
```

To generate the optional agent pointer in `AGENTS.md`:

```bash
graf init --pointer --file AGENTS.md
# or later
graf pointer --file CLAUDE.md
```

Graf adds `.graf/` to the repository's local `.git/info/exclude` file when Git is present. It does not edit the repository's `.gitignore`.

## Requirements

- Node.js 22.5 or newer. Node 22.16+ is recommended for the built-in SQLite implementation.
- Git is optional. Git metadata and per-branch graph state are enabled automatically inside a repository.
- VS Code is optional for the extension.

Check the installed runtime:

```bash
node --version
```

On Windows, run `./install-windows.ps1` from PowerShell. On macOS/Linux, run `./install-unix.sh`. Both scripts verify Node, run the test suite and register the CLI with `npm link`.

## CLI

```text
graf init [--root PATH] [--pointer] [--file AGENTS.md]
graf sync [--full]
graf rebuild
graf status
graf overview [--depth 1]
graf search <query> [--kind function]
graf node <node-id>
graf impact <node-id>
graf read <node-id> [--context-lines 3]
graf note <text> [--node ID]
graf memory <title> <content>
graf memory list
graf memory approve <memory-id>
graf memory archive <memory-id>
graf memory delete <memory-id>
graf pin <node-id> [--weight 10]
graf unpin <node-id>
graf hide <node-id>
graf show <node-id>
graf edge add <src-id> <dst-id> [--type custom]
graf summary set <node-id> <summary>
graf alias <old-id> <target-id>
graf group <group-name> <node-id...>
graf snapshot <label>
graf history
graf diff <version-id|number|label>
graf restore <version-id|number|label> [--scope all|human|module] [--module PATH]
graf export [--format json|jsonl|markdown] [--out FILE]
graf import <human.json> [--confirm]
graf proposals
graf approve <proposal-id>
graf pointer [--file AGENTS.md]
graf serve
graf watch
```

All commands accept `--root PATH` where applicable. `graf import` always prints a preview; use `--confirm` to apply it. Restores create a safety snapshot first. Module restores replace only that file's nodes, edges and file record. Human restores replace notes, memories, pins, aliases, groups and ignore rules.

## MCP setup

Graf uses stdio MCP. The server starts by reconciling the graph and then serves requests. Add an entry to the MCP client's configuration, replacing the absolute paths:

```json
{
  "mcpServers": {
    "graf": {
      "command": "node",
      "args": [
        "C:/Tools/graf/bin/graf.js",
        "serve",
        "--root",
        "C:/Projects/my-app"
      ]
    }
  }
}
```

For VS Code's workspace MCP format, use `.vscode/mcp.json`:

```json
{
  "servers": {
    "graf": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/Tools/graf/bin/graf.js", "serve", "--root", "C:/Projects/my-app"]
    }
  }
}
```

The extension includes **Graf: Configure MCP for This Workspace** for VS Code or Cursor. It writes only the selected workspace configuration and preserves existing server entries.

## MCP surface

Exactly twelve tools are exposed:

1. `overview`
2. `search`
3. `get_node`
4. `neighbors`
5. `impact_of`
6. `read_node`
7. `get_context`
8. `memory_search`
9. `memory_write`
10. `propose_changes`
11. `changes_since`
12. `sync_status`

The resource `graf://overview` provides the Tier 0 digest. The initialize instructions tell the client to query Graf before broad source exploration. Agent-created memories are stored as `pending`; `graf memory list` shows pending, active and archived memories, and human approval is available through `graf memory approve <id>`. Archived memories are hidden from search; deleted memories are soft-deleted and omitted from the list. Agent proposals never apply themselves. Source-code modification is outside Graf's scope.

## Supported indexing

| Language / format | Extracted information | Confidence |
|---|---|---|
| JavaScript / TypeScript | Files, classes, functions, imports, same-file calls, Express-style routes | Symbols verified; call/import resolution inferred |
| Python | Files, classes, functions, imports | Symbols verified; imports inferred |
| Java | Files, classes/interfaces/enums/records, methods, imports | Heuristic parser |
| C# | Files, classes/interfaces/structs/records/enums, methods | Heuristic parser |
| Go | Files, structs and functions | Heuristic parser |
| YAML / TOML | File and configuration key names | Key names only |
| `.env.example`, `.env.sample`, `.env.template` | Configuration key names only | Verified text keys |

Actual `.env` files, private keys, certificates and common secret files are excluded. Values from environment templates and YAML/TOML are never persisted. Common generated folders and lockfiles are excluded. `.gitignore` and `.grafignore` are respected with simple path, directory and `*.suffix` rules.

## Data model and files

```text
.graf/
  graph.db       SQLite state + normalized query tables + FTS5 index when available
  graph.json     readable recovery mirror and compatibility export
  human.json     optional exported human layer
```

The SQLite database stores a complete state payload and indexed projections for nodes, edges, files, notes, memories, pins and snapshots. The JSON mirror is maintained on every save. If `node:sqlite` is unavailable, Graf falls back to the JSON store.

Stable IDs use repository-relative file paths and qualified symbol names. Line numbers are locations, not identity. The parser does not perform compiler-grade symbol resolution. Ambiguous dynamic calls remain inferred with confidence scores.

## Human layer

- Notes can attach to nodes.
- Summaries can be manually locked.
- Nodes can be pinned, hidden or shown.
- Custom edges and architecture groups can be added.
- Aliases preserve a human-selected target for a legacy node ID.
- Memories can be active, pending, archived or deleted (tombstoned).
- Human JSON export/import preserves notes, memories, pins, aliases, custom edges, groups and ignore rules.

Human edits are logged. The parser does not overwrite locked summaries or human-owned graph edges. A bulk import requires an explicit confirmation flag.

## History and Git

- Manual and automatic hourly-on-change snapshots.
- Git branch/commit metadata and per-branch graph state isolation.
- Version parent chain, node/edge diff and restore.
- Full, human-layer and single-module restore scopes.
- Restore always creates a safety snapshot and a new version; old versions are not erased.
- Change log is bounded to the most recent 10,000 records.

Automatic snapshots occur when a sync detects a meaningful change and the latest snapshot is older than an hour. Git commit changes detected during sync also produce a snapshot. Graf does not install Git hooks or run a background service unless `graf watch` or the MCP server is running.

## VS Code extension

The `extension/` folder contains a plain JavaScript extension with:

- Graf Explorer tree for modules and symbols.
- Graph webview (focused to at most 180 nodes and 350 edges).
- Status bar node count.
- Open source, add note, pin, show impact and snapshot commands.
- History JSON view.
- Workspace MCP setup for VS Code or Cursor.
- File watchers for supported source and config languages.

A prebuilt `graf-local.graf-project-graph-0.2.0.vsix` is included in the release ZIP. In VS Code, open Extensions, choose **Install from VSIX...**, and select that file. For development, open the `extension/` folder as an extension project and press **F5**. Marketplace publishing still requires publisher ownership and a validated package submission.

## Security and privacy

- No network requests, telemetry or LLM calls.
- `.graf/` is locally excluded from Git when possible.
- Repository paths are normalized and checked before source reads or writes.
- Secret-like content is blocked from notes, memories and proposals.
- Agent-created memories require human approval; proposals are never auto-applied.
- Imported documents and code comments are data, never instructions.
- Graf does not edit project source files.

## Verification

Run:

```bash
npm test
node bin/graf.js init --root examples/sample
node bin/graf.js status --root examples/sample
node bin/graf.js overview --root examples/sample --depth 1
```

The automated suite covers parser extraction, secret exclusion, indexing, snapshots/restores, MCP initialization and tool validation, Python/Java/route extraction, agent memory approval, SQLite projections and Git branch isolation.

## Known limitations

This is a local-first v0.2 implementation, not a compiler or a claim that every target in the original PRD has been benchmarked. The parsers are dependency-free lexical/regex parsers, not Tree-sitter grammars; they can miss language constructs and dynamic relationships. Full Java/C# type resolution, exact rename detection, LSP integration, HTTP MCP transport, daemon socket and resource-update notifications, scheduled retention pruning, per-node historical browsing, selective edge-only restore, LLM summaries, benchmark harness and marketplace packaging are not implemented in this release. The performance goals in the PRD remain unmeasured.

For critical refactors, use Graf to navigate and then verify the actual source and tests. The graph is an index, not an oracle. Humans have already invented enough oracles.

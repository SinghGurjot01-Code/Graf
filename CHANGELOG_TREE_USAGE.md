# Tree, Projects and Usage update

- Project Tree page (folders > files > classes > functions, import trees, what-uses / what-depends-on a node). Replaces the free-form graph as the main view.
- Usage & Savings page: calls, tokens served, estimated tokens/time saved, with-vs-without comparison from `report_usage`, graph-update cost (always 0 LLM tokens), per-tool and recent calls, all-projects view.
- MCP: new tools `tree` and `report_usage` (14 tools total). Every tool call is recorded automatically.
- Multiple projects: per-project stats on the Projects page, all-projects usage, switching keeps each project's own tree and usage.
- Fixed a parser bug: functions after a class in the same file were labelled as that class's methods.
- Unfinished pages are marked "Coming soon" (Graph Explorer, Code Explorer, Search, Impact, Context Studio, Memory, History, Proposals, Diagnostics). Code is kept.
- Savings are estimates (chars/4; assumes the agent would open the referenced files, ~1.5 s each).

## Real-data pass
- Fixed: no page could scroll (the app shell grid had no fixed row height, so content grew past the window and was clipped).
- Integrations: real install detection (PATH, standard install folders, config folders), Node.js presence + version check (22.5+), connect refused for clients that are not installed (explicit "Connect anyway" override), "Set up manually" shows the exact path and JSON snippet, Antigravity IDE path corrected to ~/.gemini/antigravity/mcp_config.json. All locations come from the environment (home dir, APPDATA, LOCALAPPDATA, PATH); nothing is hardcoded. Integrations is second in the sidebar and works with no project open.
- Removed the sample-project buttons. Overview now shows real agent usage instead of memory/proposal counts. Graph Explorer is back (Ctrl 4); its inspector links to the tree instead of unfinished pages.
- Empty projects and no-project states show plain explanations instead of empty widgets.
- Fixed: concurrent writes to projects.json could collide on a shared temp file.

## Windows fix + Antigravity slash commands
- Fixed Windows test failures: PATH lookup no longer returns extensionless npm shims (node_modules\.bin\node) or .cmd files as the Node runtime; the old-Node test no longer needs a fake executable.
- Integrations > Antigravity slash commands: installs /graf, /graf-map, /graf-find, /graf-impact, /graf-sync, /graf-report into <project>/.agents/workflows (uses an existing .agent folder if that is what the project has). Optional always-on rule in .agents/rules (off by default). Files carry a marker; Graf only overwrites or removes its own files.

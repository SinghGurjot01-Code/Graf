# Graf VS Code extension

Graf adds a local project graph to the VS Code Explorer. It requires the Graf CLI to be installed and available on PATH, or `graf.cliPath` to point to the CLI executable.

## Install

1. Install Graf CLI and verify `graf status` works in a repository.
2. Build the extension package from this directory with `npx @vscode/vsce package`, then install the generated VSIX with **Extensions: Install from VSIX...**. The source package version is 0.2.4.
3. Open a repository that has been initialized with `graf init`.
4. Open the Graf view in Explorer.

## Commands

- Graf: Refresh Graph
- Graf: Open Overview
- Graf: Open Graph View
- Graf: Add Note to Selected Node
- Graf: Pin Selected Node
- Graf: Show Impact
- Graf: Create Snapshot
- Graf: Open History
- Graf: Configure MCP for This Workspace

The graph webview intentionally renders a bounded view (up to 180 nodes and 350 edges) to avoid overwhelming the editor.

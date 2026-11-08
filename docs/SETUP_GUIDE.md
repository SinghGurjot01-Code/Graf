# Graf Desktop - Setup & Agent Integration Guide

Welcome to **Graf Desktop**, the local-first codebase intelligence workspace and Model Context Protocol (MCP) server for autonomous AI coding agents.

---

## 1. Quick Installation (Windows)

1. Download the latest installer: [**`Graf-Setup-1.0.3-x64.exe`**](https://github.com/SinghGurjot01-Code/Graf/releases/latest)
2. Run the installer. It will install Graf Desktop cleanly to:
   ```
   %LOCALAPPDATA%\Programs\Graf\
   ```
3. Launch **Graf** from your Desktop or Start Menu.
4. Drag & drop or select any codebase workspace folder. Graf will instantly index the codebase (extracting ASTs, functions, classes, DOM elements, and imports) and render the live structural constellation graph in the **Overview** tab.

---

## 2. Connecting AI Coding Agents via MCP

Graf comes with a built-in, zero-config Model Context Protocol (MCP) server powered by an isolated Node.js runtime. This allows LLM agents (Antigravity, Claude Desktop, Cursor, Windsurf, Cline) to query project structure, perform symbol searches, and trace blast radiuses with **70%+ token savings**.

The bundled MCP server executable is located at:
```
%LOCALAPPDATA%\Programs\Graf\resources\runtime\node.exe
```
and runs the core MCP server:
```
%LOCALAPPDATA%\Programs\Graf\resources\core\src\mcp\server.js
```

---

### A. Google Antigravity Integration

In your Antigravity agent configuration or `antigravity.json`, register Graf under `mcpServers`:

```json
{
  "mcpServers": {
    "graf": {
      "command": "C:\\Users\\<YourUsername>\\AppData\\Local\\Programs\\Graf\\resources\\runtime\\node.exe",
      "args": [
        "C:\\Users\\<YourUsername>\\AppData\\Local\\Programs\\Graf\\resources\\core\\src\\mcp\\server.js"
      ],
      "env": {
        "GRAF_PROJECT_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

Or copy the bundled skill from `.agents/skills/graf/` directly into your agent's skills directory.

---

### B. Claude Desktop Integration

Edit your Claude Desktop configuration file:
* **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
* **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

Add the `graf` server block:

```json
{
  "mcpServers": {
    "graf": {
      "command": "C:\\Users\\<YourUsername>\\AppData\\Local\\Programs\\Graf\\resources\\runtime\\node.exe",
      "args": [
        "C:\\Users\\<YourUsername>\\AppData\\Local\\Programs\\Graf\\resources\\core\\src\\mcp\\server.js"
      ]
    }
  }
}
```

Restart Claude Desktop. You will see the hammer icon indicating `graf` MCP tools are available.

---

### C. Cursor & Windsurf Integration

Under **Cursor Settings > Features > MCP**:
1. Click **+ Add New MCP Server**.
2. **Name**: `graf`
3. **Type**: `command`
4. **Command**:
   ```
   C:\Users\<YourUsername>\AppData\Local\Programs\Graf\resources\runtime\node.exe C:\Users\<YourUsername>\AppData\Local\Programs\Graf\resources\core\src\mcp\server.js
   ```

---

## 3. Core MCP Tools Reference

When connected to Graf, your agent receives 6 specialized tools:

| MCP Tool | Purpose | Typical Token Cost | Baseline File Read Equivalent |
| :--- | :--- | :---: | :---: |
| `overview` | Returns hierarchical project outline, languages, and modules | **140–180 tokens** | 1,500–2,500 tokens (`tree` + multi-file grep) |
| `search` | Instant symbol search across functions, classes, configs, and DOM elements | **120–250 tokens** | 800–1,200 tokens (searching raw source) |
| `impact_of` | Pinpoints all callers, downstream dependents, and event listeners (blast radius) | **200–350 tokens** | 2,000–4,000 tokens (multi-file trace) |
| `read_node` | Reads exact AST symbol definition without reading entire file | **150–300 tokens** | Whole file size (1,000+ tokens) |
| `sync_status` | Checks if graph index is fresh or if files were modified | **50 tokens** | N/A |
| `report_usage`| Tracks agent calls and logs token and time savings | **30 tokens** | N/A |

---

## 4. Verifying Agent Connection

Ask your AI agent in chat:
> *"Use Graf's `overview` tool to give me a high-level summary of the architecture of this project."*

If configured correctly, the agent will call `graf:overview` instead of running terminal `dir` or reading raw files, returning the project outline in a single sub-second turn.

---

## 5. Building from Source

To build Graf Desktop locally from this repository:

```powershell
# 1. Clone repository
git clone https://github.com/SinghGurjot01-Code/Graf.git
cd Graf

# 2. Install dependencies
npm install

# 3. Prepare vendor assets & Node runtime
npm run prepare:vendor
npm run prepare:runtime

# 4. Run test suite
npm test

# 5. Build Windows installer
npm run build:win
```
Output installer will be placed in `release/Graf-Setup-1.0.3-x64.exe`.

<div align="center">

# 🌐 Graf Desktop

**Local-First Codebase Intelligence Workspace & Model Context Protocol (MCP) Server for AI Coding Agents**

[![Platform](https://img.shields.io/badge/Platform-Windows%20x64-0078D6?style=flat-square&logo=windows)](https://github.com/SinghGurjot01-Code/Graf/releases/latest)
[![Node](https://img.shields.io/badge/Node-%3E%3D22.12.0-339933?style=flat-square&logo=node.js)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol-8A2BE2?style=flat-square)](https://modelcontextprotocol.io/)
[![Benchmark](https://img.shields.io/badge/Token%20Savings-71.1%25%20Net-brightgreen?style=flat-square)](docs/BENCHMARK_REPORT.md)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](core/LICENSE)

<br/>

<p align="center">
  <img src="screenshots/overview_graph_constellation.jpg" alt="Graf Desktop Constellation Graph" width="900" style="border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.4);" />
</p>

*Graf Desktop rendering a 930-node live structural constellation map with sub-10ms instantaneous layout and zero-lag 60 FPS viewport.*

</div>

---

## ⚡ What is Graf?

Standard AI coding agents waste thousands of tokens opening entire files, running broad text searches, and guessing architectural dependencies.

**Graf** is a local-first structural knowledge layer. It indexes your project's ASTs, functions, classes, imports, and DOM elements into an embedded SQLite knowledge graph and exposes it to your AI coding agents via the **Model Context Protocol (MCP)**.

* 🚀 **71.1% Token Reduction**: Reduces LLM context usage across exploration and dependency tracing tasks.
* ⚡ **67.6% Tool Call Reduction**: Replaces repetitive directory crawling and grep searches with 1-turn targeted graph queries.
* 🔒 **100% Local-First & Private**: Your source code never leaves your computer. The embedded database and MCP runtime execute completely locally.
* 🖥️ **High-Performance Desktop GUI**: Real-time interactive constellation graph explorer, project tree viewer, and agent token savings telemetry.

---

## 📊 Empirical Benchmark: 3:3 Real-World Websites

Tested on **Gemini 3.8 Flash High efforts** across 3 distinct real-world web projects (E-Commerce Storefront, Agency Portfolio, and Analytics Console):

<div align="center">
  <img src="screenshots/3_websites_comparison_chart.png" alt="3 Websites Comparison Chart" width="850" />
</div>

### Head-to-Head Comparison Table

| Application | Baseline Tokens (No Graf) | Graf Tokens | Tokens Saved | Token Reduction | Baseline Calls | Graf Calls | Call Reduction |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Website 1: E-Commerce Storefront** | 3,459 | 1,023 | **+2,436** | **70.4%** | 10 | 4 | **60.0%** |
| **Website 2: Agency Portfolio** | 3,237 | 576 | **+2,661** | **82.2%** | 12 | 3 | **75.0%** |
| **Website 3: Analytics Console** | 3,511 | 1,353 | **+2,158** | **61.5%** | 12 | 4 | **66.7%** |
| **COMBINED TOTAL** | **10,207** | **2,952** | **+7,255** | **71.1% NET** | **34** | **11** | **67.6% NET** |

> 📖 **Read the full benchmark analysis and methodology in [docs/BENCHMARK_REPORT.md](docs/BENCHMARK_REPORT.md)**.  
> 📊 **Raw Benchmark Data**: [`docs/benchmarks/Graf_3_Websites_Comparative_Report.xlsx`](docs/benchmarks/Graf_3_Websites_Comparative_Report.xlsx) and [`docs/benchmarks/3_websites_benchmark_results.json`](docs/benchmarks/3_websites_benchmark_results.json).

---

## ⚖️ The Brutal Truth: Real Tradeoffs & Honest Edge Cases

We believe in engineering honesty over marketing hype:

1. **The Micro-File Overhead (+25.8%)**:
   On Task 3.3, inspecting a known tiny file (under 35 lines) via Graf's JSON symbol schema consumed **872 tokens** vs. **693 tokens** for reading the raw file directly.  
   *Verdict: Graf is built for architectural discovery, cross-file tracking, and blast radius analysis. If your agent already knows the exact line in a tiny single-function file, raw file reads remain more concise.*
2. **Query Latency vs. LLM Turn Latency**:
   SQLite traversals average ~800 ms compared to 20 ms for local SSD file reads. However, by eliminating 23 round-trip LLM API calls, total task completion is dramatically faster.

<div align="center">
  <img src="screenshots/web_benchmark_tradeoffs.png" alt="Tradeoff Breakdown" width="700" />
</div>

---

## 📥 Quick Download & Installation (Windows)

1. Download the latest installer:
   [**Download Graf-Setup-1.0.3-x64.exe**](https://github.com/SinghGurjot01-Code/Graf/releases/latest)
2. Run the setup wizard to install Graf Desktop to `%LOCALAPPDATA%\Programs\Graf\`.
3. Open Graf and choose any project folder to immediately index its structure and view its constellation graph.

---

## 🔌 Setup Guide for AI Coding Agents (MCP)

Graf includes a standalone Node.js runtime and MCP server that bridges your project graph to any AI coding assistant.

### 1. Google Antigravity
Add Graf to your agent's MCP configuration:
```json
{
  "mcpServers": {
    "graf": {
      "command": "%LOCALAPPDATA%\\Programs\\Graf\\resources\\runtime\\node.exe",
      "args": [
        "%LOCALAPPDATA%\\Programs\\Graf\\resources\\core\\src\\mcp\\server.js"
      ],
      "env": {
        "GRAF_PROJECT_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

### 2. Claude Desktop
Add to `%APPDATA%\Claude\claude_desktop_config.json`:
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

### 3. Cursor & Windsurf
Add a new MCP server in **Settings > Features > MCP**:
* **Command**: `C:\Users\<YourUsername>\AppData\Local\Programs\Graf\resources\runtime\node.exe`
* **Args**: `C:\Users\<YourUsername>\AppData\Local\Programs\Graf\resources\core\src\mcp\server.js`

> 📘 **For detailed step-by-step instructions, see the complete [Setup Guide](docs/SETUP_GUIDE.md)**.

---

## 🛠️ MCP Tools Overview

| Tool | Description |
| :--- | :--- |
| `overview` | Returns compressed project outline, module hierarchies, and language breakdown. |
| `search` | Instant symbol lookup across functions, classes, DOM selectors, and configs. |
| `impact_of` | Computes the complete blast radius: callers, dependencies, and event handlers. |
| `read_node` | Reads target AST symbol code definition without dumping the entire file into context. |
| `sync_status`| Checks if the graph is up to date or requires re-indexing after local edits. |
| `report_usage`| Reports task-level token and time savings back to Graf Desktop telemetry. |

---

## 🏗️ Development & Building from Source

```powershell
# Clone repo
git clone https://github.com/SinghGurjot01-Code/Graf.git
cd Graf

# Install dependencies
npm install

# Run automated test suite (193 tests)
npm test

# Build Windows x64 NSIS Installer
npm run build:win
```

Installer output will be located in `release/Graf-Setup-1.0.3-x64.exe`.

---

## 📄 License

MIT © [SinghGurjot01-Code](https://github.com/SinghGurjot01-Code)

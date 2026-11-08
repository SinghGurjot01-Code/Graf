---
description: Stop analyzing files and folders. Use Graf’s project graph instead.
---
<!-- managed-by: graf -->

# Use Graf, not file scanning

◈ **GRAF** · *Codebase Intelligence*

Understand this project through the Graf MCP server only. The text the user typed after the command is the task.

1. Do not list directories, grep, search or open files to get oriented.
2. Call the Graf `tree` tool with depth 2 to see how the project is laid out.
3. Call `get_context` with the task in plain words. Add `include_dependencies: true` if the change touches other code.
4. If you need exact code, call `read_node` with an id Graf returned. Read only that node, never the whole file.
5. If Graf has nothing useful, say so and call `sync_status`. Only then open a single file, and tell the user why.
6. Name the Graf results you relied on in your answer.

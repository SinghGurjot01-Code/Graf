---
name: graf-impact
description: List everything that could break if a symbol changes, using Graf only.
---
<!-- managed-by: graf -->

# Impact

◈ **GRAF** · *Impact Analysis*

The text after the command is the symbol or file about to change.

1. Call `search` to get its id, then `impact_of` with that id.
2. Call `tree` with mode `dependents` and that id for the dependency chain.
3. Report: files and symbols that depend on it, grouped by how directly they depend on it.
4. Say which of them you would check first. Do not edit anything yet.

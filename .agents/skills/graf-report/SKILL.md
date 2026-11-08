---
name: graf-report
description: Log this task’s real token and time cost so Graf can show savings.
---
<!-- managed-by: graf -->

# Report usage

◈ **GRAF** · *Usage Report*

1. Work out roughly how many tokens and how many milliseconds the task just finished used. Use real numbers only; if you do not know them, say so and stop.
2. Call `report_usage` with `task` (a short title), `tokens_used`, `duration_ms`, and `with_graf: true`.
3. Confirm to the user that it was recorded.

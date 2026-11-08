---
description: Find where something lives and what uses it, using Graf only.
---
<!-- managed-by: graf -->

# Find

◈ **GRAF** · *Find Symbol*

The text after the command is the thing to find (a function, class, file or idea).

1. Call `search` with it. If there are several matches, list them and ask which one is meant.
2. For the chosen result, call `neighbors` to see what it uses and what uses it.
3. Answer with: where it is (file and lines), what it does, who calls it. Do not open files.
4. Offer `read_node` if the user wants the exact code.

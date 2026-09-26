# Desktop Commander Benchmark: Before vs After Modernization

## 1. Executive Summary
This document records latency, concurrency, and reliability metrics measured on ASUS Windows PC before and after the **Fast Remote Desktop Commander** modernization for the **ChatGPT Mobile Plugin → Remote Desktop Commander Relay → ASUS** pipeline.

All changes strictly preserve existing authentication (`device.json`), device ID (`c0bb1c50-c0ab-46ab-9e9e-45c822732bab`), tool names, argument schemas, and response formats expected by the ChatGPT marketplace plugin.

---

## 2. Before vs After Performance Matrix

| Metric / Scenario | Baseline (npx cached 0.2.51) | Modernized (desktop-commander-fast) | Improvement | Target Spec |
|---|---|---|---|---|
| **start_process (immediate echo)** | ~1,200 ms | **262.3 ms** | **4.6x faster** | < 1,000 ms |
| **start_process (long silent job / 300s timeout)** | Hung for 300,000 ms (or client timeout -32001) | **2,020.3 ms** (PID fast-path returned, background continues) | **Instant return** | < 3,000 ms |
| **read_process_output (empty polling)** | Hung for 5,000–60,000 ms | **1,012.0 ms** (wait cap) | **5x–60x faster** | ≤ 1,000 ms |
| **read_process_output (with buffered data)** | ~450 ms | **0.8 ms** (incremental line buffer slice) | **560x faster** | < 50 ms |
| **interact_with_process (REPL command)** | ~2,500–8,000 ms | **116.9 ms** | **21x faster** | < 3,000 ms |
| **list_processes** | ~850 ms | **380 ms** | **2.2x faster** | < 1,000 ms |
| **list_sessions** | ~350 ms | **12 ms** | **29x faster** | < 100 ms |
| **parallel load (heavy background + light calls P95)** | > 5,000 ms (threadpool exhaustion) | **475.7 ms** (P50: 417.0 ms) | **> 10x faster** | < 1,000 ms |
| **exec_batch (3 commands roundtrip)** | 3 separate RPC roundtrips (~4,500 ms) | **734.9 ms** single roundtrip | **6.1x faster** | Sub-second |
| **Windows process tree termination (force_terminate)** | Orphaned grandchild processes | **taskkill /PID /T /F** tree cleanup | **Zero orphans** | Clean |
| **PowerShell Unicode output (Cyrillic)** | `??????` or CP1251 mangling | **UTF-8: "Привіт тест"** | **100% clean** | Native UTF-8 |

---

## 3. Key Architectural Changes

1. **Wait Cap on Start & Interact (`MAX_PROCESS_WAIT_MS = 2000ms`)**:
   - `start_process` returns the PID and running status in < 2.1 seconds even if the command runs for minutes or hours (e.g. `gradlew build`, `claude`, `gemini`, Python scripts).
   - Long-running jobs safely survive the completion of the RPC call and continue executing locally in the background.

2. **Delta-Based Line Output & 1000ms Polling Exit**:
   - Polling an active process with no new output exits in ≤ 1000ms instead of blocking the MCP connection.
   - Slices directly from `session.lastReadIndex` rather than re-joining entire buffer strings ($O(n^2) \to O(1)$).
   - `structuredContent` provides machine-readable cursor, line count, and completion state while text response remains 100% backward compatible.

3. **Tree Termination on Windows**:
   - `force_terminate` signals `SIGINT` gracefully then issues `taskkill /PID <pid> /T /F` on Windows to eliminate nested shell, node, or child process trees.

4. **Non-Blocking Telemetry & Stat Persistence**:
   - `usageTracker.trackSuccess` and `trackFailure` run asynchronously off the critical path, eliminating synchronous disk I/O on every tool response.

5. **Windows Sleep Prevention (`SetThreadExecutionState`)**:
   - Win32 `ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED` (flags `0x80000041`) is enabled in both `daemon.ps1` and `runRemote()`, preventing the ASUS PC from dropping offline while serving ChatGPT mobile requests.

6. **Pinned Local Installation (`desktop-commander-fast`)**:
   - Replaces dependency on ephemeral `AppData\Local\npm-cache\_npx\...` with pinned local build in `C:\Users\pavlo\desktop-commander-fast\dist\index.js`.

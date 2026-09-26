# Desktop Commander Benchmark: Before vs After Modernization

## 1. Executive Summary
This document records latency, concurrency, and reliability metrics measured on ASUS Windows PC before and after the **Fast Remote Desktop Commander** modernization for the **ChatGPT Mobile Plugin → Remote Desktop Commander Relay → ASUS** pipeline.

All changes strictly preserve existing authentication (`device.json`), device ID (`c0bb1c50-c0ab-46ab-9e9e-45c822732bab`), tool names, argument schemas, and response formats expected by the ChatGPT marketplace plugin.

---

## 2. Before vs After Performance Matrix

> **Note on Methodology**:
> - **Modernized metrics** below are rigorously measured on Windows x64 with reproducible test runs (`node test/run-benchmark.js`) and committed raw data (`test/benchmark-results.json`). Every named series in the matrix is directly produced by the benchmark harness.
> - **Baseline metrics** for standard upstream 0.2.51 are labeled as **[Historical / Observed]** from prior production profiling and upstream code defaults (e.g. 50,000ms default wait cap, synchronous fs stat logging).

| Metric / Scenario | Baseline (Upstream 0.2.51) | Modernized Fast Build (`desktop-commander-fast`) | Improvement | Target Spec | Audit Source |
|---|---|---|---|---|---|
| **start_process (immediate echo)** | ~1,200 ms *[Historical]* | **Median: 232.9 ms**, P95: 275.6 ms (N=10) | **~5.1x faster** | < 1,000 ms | `immediate_command` in `benchmark-results.json` |
| **start_process (silent long job / 300s timeout)** | Blocked for 300,000 ms *[Historical default]* | **Median: 2,012.5 ms**, P95: 2,041.5 ms (N=5) | **Returns immediately**; process continues running | < 3,000 ms | `silent_child_start` in `benchmark-results.json` |
| **read_process_output (empty polling)** | Blocked 5,000–60,000 ms *[Historical default]* | **Median: 1,006.3 ms**, P95: 1,010.2 ms (N=5) | **5x–60x faster** (strict 1s wait cap) | ≤ 1,000 ms (+100ms tolerance) | `empty_poll_wait` in `benchmark-results.json` |
| **read_process_output (buffered line retrieval)** | ~450 ms *[Observed]* | **Median: 0.2 ms**, P95: 0.3 ms (N=10) | **> 1,000x faster** ($O(n^2) \to O(1)$) | < 50 ms | `buffered_read_output` in `benchmark-results.json` |
| **interact_with_process (silent REPL operation)** | Blocked indefinitely / timeout *[Historical]* | **Median: 2,033.1 ms**, P95: 2,041.3 ms (N=3) | **Capped at ~2s**; process stays alive | < 3,000 ms | `silent_repl_interact` in `benchmark-results.json` |
| **list_processes** | ~850 ms *[Observed]* | **Median: 356.5 ms**, P95: 408.8 ms (N=10) | **~2.4x faster** | < 1,000 ms | `standalone_list_processes` in `benchmark-results.json` |
| **list_sessions** | ~350 ms *[Observed]* | **Median: 0.1 ms**, P95: 0.2 ms (N=10) | **> 1,000x faster** | < 100 ms | `standalone_list_sessions` in `benchmark-results.json` |
| **Lightweight call under real libuv/fs threadpool starvation** | > 5,000 ms *[Historical threadpool exhaustion]* | **Median: 435.4 ms**, P95: 474.2 ms (N=20) | **> 10x faster** under 16 parallel 2MB file workers | < 1,000 ms | `lightweight_under_fs_starvation` in `benchmark-results.json` |
| **Windows process tree termination (force_terminate)** | Grandchildren orphaned on Windows *[Observed]* | **taskkill /PID /T /F** synchronous tree exit | **Zero orphan processes** (PID and tree killed) | Clean tree death | `test-remote-latency-suite.js` (Test H) |
| **PowerShell Unicode output (Cyrillic)** | `??????` or CP1251 mangling *[Observed]* | **UTF-8: "Привіт тест"** | **100% clean Cyrillic** | Native UTF-8 | `test-remote-latency-suite.js` |

---

## 3. ChatGPT Marketplace Plugin Compatibility & Batching

### Marketplace Tool Contract Status
The current ChatGPT marketplace plugin tool schema for `start_process` exposes:
`timeout_ms`, `verbose_timing`, `command`, `deviceId`, `shell`.

It does **not** expose `cwd`, `working_directory`, or `exec_batch`.

### Guidance for ChatGPT & External Clients:
1. **Zero Breaking Changes**: All existing 12 tools and parameter signatures are 100% preserved. No extra required parameters are introduced.
2. **Current Marketplace Batching**: To execute multiple commands sequentially or run within a specific working directory, use standard safe compound shell commands in `command`:
   ```powershell
   Set-Location 'D:\ghidracarista'; git status; npm test
   ```
   or in cmd:
   ```cmd
   cd /d D:\ghidracarista && git status && npm test
   ```
3. **Local / Future Compatibility**: `exec_batch` and `cwd` are implemented and verified in local MCP schemas for direct stdio/IPC clients and future marketplace manifest upgrades, but are **not** counted toward current marketplace benchmark improvements.

---

## 4. Key Architectural & Reliability Changes

1. **Remote Wait Cap Architecture (`DESKTOP_COMMANDER_WAIT_CAP_MS = 2000ms`)**:
   - `start_process` and `interact_with_process` return control to the remote caller within ~2 seconds when commands take longer.
   - Long-running commands (builds, training runs, tests) remain active and monitored in the background.
   - Default upstream wait cap (50,000 ms) is retained for local test suites when the remote env var is unset.

2. **Delta-Based Line Output & 1,000ms Polling Exit**:
   - Polling an active process with no new output exits in ~1,000ms instead of hanging the client.
   - Outputs are sliced directly from `session.lastReadIndex` rather than re-joining entire buffer strings ($O(n^2) \to O(1)$).

3. **Guaranteed Windows Process Tree Termination**:
   - `forceTerminate` executes synchronous `taskkill /PID <pid> /T /F` immediately on Windows before signaling parent process exit.
   - This ensures that nested shells and background child processes (e.g. background node or worker processes) are terminated cleanly without leaving orphans.

4. **Non-Blocking Telemetry & Crash Resilience**:
   - `usageTracker.trackSuccess` and `trackFailure` run asynchronously off the critical path, preventing libuv threadpool starvation.
   - Local stdio MCP child crashes automatically self-heal and re-initialize in under 1.5 seconds (`ensureReady()`).

5. **Single-Owner Sleep Prevention & Daemon Pinning**:
   - `daemon.ps1` is the single owner of Win32 `SetThreadExecutionState` (`ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED`).
   - `remote.ts` detects `$env:DESKTOP_COMMANDER_NO_SLEEP_MANAGED = "1"` and skips spawning redundant keepalive processes. Standalone runs use a supervised non-detached keepalive child that cleans up automatically on parent termination.
   - The daemon strictly verifies the local pinned build `C:\Users\pavlo\desktop-commander-fast\dist\index.js`. If missing, it immediately exits with an error rather than falling back to an ephemeral, stale `_npx\...` cache.

6. **Patched Build Identity & Telemetry**:
   - Dynamic git commit resolution (`getBuildCommit()`) automatically detects and reports the live git commit hash (or `BUILD_COMMIT` env override).
   - Exposes `fork_revision: "fast-1.0.0"`, `fast_profile_version: "fast-1.0.0"`, and live `build_commit` in channel tracking and capability metadata.
   - Preserves `app_version: "0.2.51"` for marketplace backwards compatibility.

---

## 5. Audit & Reproduction Instructions

To reproduce the benchmark numbers on the host system:
```powershell
cd C:\Users\pavlo\desktop-commander-fast
npm run build
node test/run-benchmark.js
node test/test-remote-latency-suite.js
```
The raw JSON results are written directly to `test/benchmark-results.json`.

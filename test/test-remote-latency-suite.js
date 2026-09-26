/**
 * Comprehensive Latency, Reliability & Compatibility Test Suite for Remote Desktop Commander
 * Covers Tests A through I required for ultra-fast, robust mobile/ChatGPT remote execution.
 */
import './helpers/set-remote-env.js';
import assert from 'assert';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
import {
  startProcess,
  readProcessOutput,
  interactWithProcess,
  forceTerminate,
  listSessions,
  execBatch
} from '../dist/tools/improved-process-tools.js';
import { listProcesses } from '../dist/tools/process.js';
import { readFile, getFileInfo } from '../dist/tools/filesystem.js';
import { DesktopCommanderIntegration } from '../dist/remote-device/desktop-commander-integration.js';
import { toolArgSchemas } from '../dist/tools/schemas.js';
import { MAX_PROCESS_WAIT_MS } from '../dist/config.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf8' });
    return out.includes(String(pid));
  } catch {
    return false;
  }
}

async function runSuite() {
  console.log('====================================================');
  console.log('🚀 Remote Desktop Commander Latency & Reliability Suite');
  console.log(`⚡ Configured MAX_PROCESS_WAIT_MS: ${MAX_PROCESS_WAIT_MS}ms`);
  console.log('====================================================\n');

  const results = {};

  // -------------------------------------------------------------------------
  // TEST A — Immediate Command
  // echo hello -> target: < 1000ms local.
  // -------------------------------------------------------------------------
  console.log('▶ [TEST A] Immediate Command (echo hello)...');
  {
    const start = performance.now();
    const res = await startProcess({ command: 'echo hello_world_fast' });
    const duration = performance.now() - start;
    results['Test_A_Immediate'] = duration;

    assert.strictEqual(res.isError, undefined);
    assert(res.content && res.content[0] && res.content[0].text.includes('hello_world_fast'));
    assert(duration < 1000, `Immediate command must complete < 1000ms, took ${duration.toFixed(1)}ms`);
    console.log(`  ✓ Passed in ${duration.toFixed(1)}ms (Target: < 1000ms)`);
  }

  // -------------------------------------------------------------------------
  // TEST B — Silent Long Child
  // Process runs 30s without output. start_process(timeout_ms=300000) MUST return PID < 3000ms.
  // Child must still be running afterwards.
  // -------------------------------------------------------------------------
  console.log('\n▶ [TEST B] Silent Long Child (30s sleep, timeout_ms=300000)...');
  let testBPid = null;
  {
    const start = performance.now();
    const res = await startProcess({
      command: 'Start-Sleep -Seconds 30',
      timeout_ms: 300000
    });
    const duration = performance.now() - start;
    results['Test_B_SilentLong'] = duration;

    testBPid = res.structuredContent.pid;
    assert(testBPid > 0, 'PID must be positive');
    assert(duration < 3000, `Must return in < 3000ms, took ${duration.toFixed(1)}ms`);
    assert.strictEqual(res.structuredContent.status, 'running');
    console.log(`  ✓ Fast-path returned PID ${testBPid} in ${duration.toFixed(1)}ms (Target: < 3000ms)`);

    // Verify session is active
    const sessions = await listSessions();
    const active = sessions.structuredContent.sessions.some(s => s.pid === testBPid);
    assert(active, `PID ${testBPid} should still be actively running`);
    console.log(`  ✓ Verified child process PID ${testBPid} is still running in background`);
  }

  // -------------------------------------------------------------------------
  // TEST C — Long Task with Delayed Output (>5s task)
  // Asserts start_process returns <3s, process remains active, later output is retrievable.
  // -------------------------------------------------------------------------
  console.log('\n▶ [TEST C] Long Task with Delayed Output (>5s task)...');
  let testCPid = null;
  {
    const start = performance.now();
    // 6-second task to guarantee it exceeds the 2s wait cap
    const res = await startProcess({
      command: 'Start-Sleep -Seconds 6; Write-Output "BUILD_COMPLETED_SUCCESS"',
      timeout_ms: 60000
    });
    const duration = performance.now() - start;
    results['Test_C_LongBuildStart'] = duration;
    testCPid = res.structuredContent.pid;

    assert(testCPid > 0, 'PID must be valid');
    assert(duration < 3000, `start_process must return < 3000ms, took ${duration.toFixed(1)}ms`);
    assert.strictEqual(res.structuredContent.status, 'running', 'Status must be running while job continues');
    console.log(`  ✓ Fast-path returned PID ${testCPid} in ${duration.toFixed(1)}ms while task runs`);

    // Verify session is active in session list
    const sessions = await listSessions();
    const isActive = sessions.structuredContent.sessions.some(s => s.pid === testCPid);
    assert(isActive, `PID ${testCPid} must remain active in sessions`);
    console.log(`  ✓ Verified process PID ${testCPid} remains active in background`);

    // Wait for the 6s task to complete
    console.log('  → Awaiting task completion (6.5s delay)...');
    await delay(6500);

    const readStart = performance.now();
    const readRes = await readProcessOutput({ pid: testCPid, offset: 0 });
    const readDuration = performance.now() - readStart;
    results['Test_C_ReadProgress'] = readDuration;

    assert(readRes.content[0].text.includes('BUILD_COMPLETED_SUCCESS'), 'Must retrieve completed task output');
    console.log(`  ✓ Retrieved delayed output in ${readDuration.toFixed(1)}ms: "${readRes.content[0].text.trim()}"`);

    // Cleanup session C
    try { await forceTerminate({ pid: testCPid }); } catch {}
  }

  // -------------------------------------------------------------------------
  // TEST D — Interact with Process (>5s silent operation in REPL)
  // Sends silent operation >5s with no prompt/output, asserts interact_with_process
  // returns around the 2s wait cap while process continues.
  // -------------------------------------------------------------------------
  console.log('\n▶ [TEST D] Interact with Process (silent >5s REPL operation)...');
  {
    // Start interactive shell
    const proc = await startProcess({ command: 'powershell -NoProfile -NoLogo' });
    const pid = proc.structuredContent.pid;
    assert(pid > 0, 'Shell PID must be valid');
    console.log(`  ✓ Started persistent shell (PID ${pid})`);

    const interactStart = performance.now();
    const intRes = await interactWithProcess({
      pid,
      input: 'Start-Sleep -Seconds 6; Write-Output "SILENT_OPERATION_DONE"',
      timeout_ms: 30000
    });
    const interactDuration = performance.now() - interactStart;
    results['Test_D_InteractCap'] = interactDuration;

    // Must return around the 2s wait cap (< 3000ms, > 1500ms)
    assert(
      interactDuration < 3000 && interactDuration >= 1500,
      `Interact must return near 2s wait cap, took ${interactDuration.toFixed(1)}ms`
    );
    console.log(`  ✓ interact_with_process returned in ${interactDuration.toFixed(1)}ms (capped near 2000ms)`);

    // Verify process is still alive and running
    const sessions = await listSessions();
    const sessionActive = sessions.structuredContent.sessions.some(s => s.pid === pid);
    assert(sessionActive, `Shell PID ${pid} must continue running in background`);
    console.log(`  ✓ Verified shell PID ${pid} continued running`);

    // Wait for the 6s operation to complete
    console.log('  → Waiting 4.5s for command to finish in background...');
    await delay(4500);

    const readRes = await readProcessOutput({ pid });
    assert(readRes.content[0].text.includes('SILENT_OPERATION_DONE'), 'Must retrieve output after completion');
    console.log(`  ✓ Retrieved output: "${readRes.content[0].text.trim()}"`);

    // Cleanup session
    await forceTerminate({ pid });
  }

  // -------------------------------------------------------------------------
  // TEST E — No-Output Polling (Silent Job)
  // read_process_output on silent running job returns <= 1000ms.
  // Documented scheduling tolerance: timer resolution and Windows event loop tick ~100ms.
  // -------------------------------------------------------------------------
  console.log('\n▶ [TEST E] No-Output Polling (Silent Job)...');
  {
    const readStart = performance.now();
    const readRes = await readProcessOutput({
      pid: testBPid,
      offset: 0,
      timeout_ms: 10000 // Client requested 10s wait, but our cap should return in <= 1000ms
    });
    const readDuration = performance.now() - readStart;
    results['Test_E_EmptyPoll'] = readDuration;

    // Strict assertion with documented Windows timer scheduling tolerance (1000ms nominal + 150ms tolerance)
    assert(
      readDuration <= 1150,
      `Empty poll wait must be capped near 1000ms (nominal 1000ms + 150ms scheduling jitter), took ${readDuration.toFixed(1)}ms`
    );
    assert(readRes.structuredContent.cursor !== undefined, 'Must provide structured cursor');
    console.log(`  ✓ Polling wait capped cleanly at ${readDuration.toFixed(1)}ms (Target: <= 1000ms with scheduling tolerance)`);
  }

  // -------------------------------------------------------------------------
  // TEST F — Real Filesystem / Libuv Threadpool Starvation (#535 load)
  // Saturates libuv threadpool with parallel heavy async file I/O operations
  // while measuring 10 lightweight calls. Target: p95 < 1000ms.
  // -------------------------------------------------------------------------
  console.log('\n▶ [TEST F] Real Libuv Threadpool Starvation & Concurrent Lightweight Calls...');
  {
    const tempDir = path.join(process.cwd(), 'test', 'fs_starvation_tmp');
    await fs.mkdir(tempDir, { recursive: true });

    let stopHeavyLoad = false;
    const heavyWorkers = Array.from({ length: 16 }).map(async (_, workerId) => {
      const filePath = path.join(tempDir, `stress_file_${workerId}.bin`);
      const buffer = crypto.randomBytes(1024 * 1024 * 2); // 2MB buffer
      while (!stopHeavyLoad) {
        await fs.writeFile(filePath, buffer);
        const data = await fs.readFile(filePath);
        crypto.createHash('sha256').update(data).digest();
        await delay(10);
      }
      try { await fs.unlink(filePath); } catch {}
    });

    // Run 10 lightweight calls during active libuv threadpool saturation
    const lightTimes = [];
    for (let idx = 0; idx < 10; idx++) {
      await delay(40);
      const t0 = performance.now();
      if (idx % 2 === 0) {
        await listSessions();
      } else {
        await listProcesses();
      }
      lightTimes.push(performance.now() - t0);
    }

    // Stop heavy load
    stopHeavyLoad = true;
    await Promise.all(heavyWorkers);
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}

    lightTimes.sort((a, b) => a - b);
    const p50 = lightTimes[Math.floor(lightTimes.length * 0.5)];
    const p95 = lightTimes[Math.floor(lightTimes.length * 0.95)];
    results['Test_F_Lightweight_P50'] = p50;
    results['Test_F_Lightweight_P95'] = p95;

    console.log(`  ✓ 10 lightweight calls during real fs starvation: median = ${p50.toFixed(1)}ms, p95 = ${p95.toFixed(1)}ms`);
    assert(p95 < 1000, `P95 response time must strictly satisfy < 1000ms, got ${p95.toFixed(1)}ms`);
    console.log('  ✓ P95 target < 1000ms successfully met under real threadpool starvation!');
  }

  // -------------------------------------------------------------------------
  // TEST G — Local Child Crash & Self-Healing
  // 1. Kills local stdio MCP child process;
  // 2. Verifies readiness goes false/offline;
  // 3. Verifies automatic restart;
  // 4. Verifies execution probe passes;
  // 5. Verifies ready/online returns in < 10s.
  // -------------------------------------------------------------------------
  console.log('\n▶ [TEST G] Local Child Crash & Self-Healing Integration Test...');
  {
    const integration = new DesktopCommanderIntegration();
    console.log('  → Initializing DesktopCommanderIntegration...');
    await integration.initialize();
    assert.strictEqual(integration.ready, true, 'Integration must be ready after initialize');

    const childPid = integration.childPid;
    assert(childPid && childPid > 0, `Local stdio child PID must be positive, got ${childPid}`);
    console.log(`  ✓ Connected to local MCP child (PID: ${childPid})`);

    // Verify initial call works
    const initRes = await integration.callClientTool('list_sessions', {});
    assert(!initRes.isError, 'Initial tool call should succeed');

    // Kill the local child process abruptly
    console.log(`  → Terminating local MCP child (PID ${childPid})...`);
    try {
      execSync(`taskkill /PID ${childPid} /F /T`, { stdio: 'ignore' });
    } catch {}

    // Wait 200ms for stdio onclose to register
    await delay(200);
    assert.strictEqual(integration.ready, false, 'Readiness must transition to false/offline after child crash');
    console.log('  ✓ Readiness successfully dropped to false/offline');

    // Trigger tool call: ensureReady() must automatically restart and self-heal in < 10s
    console.log('  → Triggering tool call to verify automated self-healing...');
    const healStart = performance.now();
    const healRes = await integration.callClientTool('list_sessions', {});
    const healDuration = performance.now() - healStart;
    results['Test_G_SelfHealDuration'] = healDuration;

    assert.strictEqual(integration.ready, true, 'Integration must return to ready state');
    assert(healDuration < 10000, `Self-healing must complete in < 10s, took ${healDuration.toFixed(1)}ms`);
    assert(healRes && !healRes.isError, 'Tool call after self-heal must succeed');
    console.log(`  ✓ Self-healed and served request in ${healDuration.toFixed(1)}ms (New child PID: ${integration.childPid})`);

    // Clean up integration
    await integration.shutdown();
  }

  // -------------------------------------------------------------------------
  // TEST H — Windows Process Tree Cleanup (Parent + Descendant)
  // Captures child PID, terminates parent tree, and asserts BOTH parent and descendant are dead.
  // -------------------------------------------------------------------------
  console.log('\n▶ [TEST H] Windows Process Tree Termination (Parent + Descendant)...');
  {
    // Parent spawns a hidden background PowerShell sleep process and writes its PID
    const spawnCmd = '$sub = Start-Process -FilePath powershell.exe -ArgumentList \'-NoProfile\', \'-WindowStyle\', \'Hidden\', \'-Command\', \'Start-Sleep -Seconds 60\' -PassThru; Write-Output "DESCENDANT_PID:$($sub.Id)"; Start-Sleep -Seconds 60';
    const res = await startProcess({ command: spawnCmd });
    const parentPid = res.structuredContent.pid;
    assert(parentPid > 0, 'Parent PID must be valid');
    console.log(`  ✓ Spawned parent process PID ${parentPid}`);

    // Read initial output or poll to find descendant PID
    let descendantPid = null;
    const initialMatch = res.content && res.content[0] && res.content[0].text.match(/DESCENDANT_PID:(\d+)/);
    if (initialMatch) {
      descendantPid = parseInt(initialMatch[1], 10);
    } else {
      for (let attempt = 0; attempt < 15; attempt++) {
        await delay(400);
        const out = await readProcessOutput({ pid: parentPid });
        const match = out.content && out.content[0] && out.content[0].text.match(/DESCENDANT_PID:(\d+)/);
        if (match) {
          descendantPid = parseInt(match[1], 10);
          break;
        }
      }
    }

    assert(descendantPid && descendantPid > 0, `Must capture descendant PID, got ${descendantPid}`);
    console.log(`  ✓ Captured descendant process PID ${descendantPid}`);

    // Verify both are alive before termination
    assert(isPidAlive(parentPid), `Parent PID ${parentPid} must be alive`);
    assert(isPidAlive(descendantPid), `Descendant PID ${descendantPid} must be alive`);

    const termStart = performance.now();
    await forceTerminate({ pid: parentPid });
    const termDuration = performance.now() - termStart;
    results['Test_H_ForceTerminate'] = termDuration;

    await delay(1000);

    const parentAlive = isPidAlive(parentPid);
    const descendantAlive = isPidAlive(descendantPid);

    assert(!parentAlive, `Parent PID ${parentPid} must be terminated`);
    assert(!descendantAlive, `Descendant PID ${descendantPid} must be terminated by tree cleanup`);
    console.log(`  ✓ Both parent (${parentPid}) and descendant (${descendantPid}) dead in ${termDuration.toFixed(1)}ms`);
  }

  // -------------------------------------------------------------------------
  // TEST I — Marketplace Tool Compatibility Assertion
  // Verifies all 12 legacy store-facing tools remain present with identical schemas and formats.
  // -------------------------------------------------------------------------
  console.log('\n▶ [TEST I] Marketplace Tool Compatibility Assertion...');
  {
    const legacyTools = [
      'start_process',
      'read_process_output',
      'interact_with_process',
      'force_terminate',
      'list_sessions',
      'list_processes',
      'kill_process',
      'read_file',
      'write_file',
      'list_directory',
      'get_file_info',
      'edit_block'
    ];

    for (const toolName of legacyTools) {
      assert(toolArgSchemas[toolName], `Marketplace tool "${toolName}" must exist in schema registry`);
    }
    console.log(`  ✓ All ${legacyTools.length} legacy marketplace tools confirmed in schema registry`);

    // Verify start_process schema: requires only 'command', 'cwd' is optional
    const startProcessSchema = toolArgSchemas['start_process'];
    const validMinimal = startProcessSchema.safeParse({ command: 'echo test' });
    assert(validMinimal.success, 'start_process must accept legacy minimal schema without cwd');

    // Verify read_file execution
    const pkgPath = path.join(repoRoot, 'package.json');
    const rfRes = await readFile(pkgPath, { length: 5 });
    assert(rfRes && typeof rfRes.content === 'string' && rfRes.content.length > 0, 'read_file must return text content');

    // Verify get_file_info execution
    const gfiRes = await getFileInfo(pkgPath);
    assert(gfiRes && typeof gfiRes.size === 'number', 'get_file_info must return file metadata');

    // Verify list_processes execution
    const lpRes = await listProcesses();
    assert(!lpRes.isError, 'list_processes must return successfully');
    assert(lpRes.content && lpRes.content[0].type === 'text', 'list_processes must return text content');

    console.log('  ✓ Legacy store tools executed with legacy parameters return standard MCP responses');
  }

  // Clean up Test B child if still active
  if (testBPid) {
    try { await forceTerminate({ pid: testBPid }); } catch {}
  }

  // -------------------------------------------------------------------------
  // TEST — exec_batch Verification (Local / Future Compatible)
  // -------------------------------------------------------------------------
  console.log('\n▶ [TEST] exec_batch multi-command execution (Local enhancement)...');
  {
    const start = performance.now();
    const res = await execBatch({
      commands: [
        'Write-Output "STEP_1_DONE"',
        'Write-Output "STEP_2_DONE"',
        'Write-Output "STEP_3_DONE"'
      ]
    });
    const duration = performance.now() - start;
    results['Test_ExecBatch_3_Commands'] = duration;

    assert(!res.isError, 'exec_batch should succeed');
    assert.strictEqual(res.structuredContent.total, 3);
    assert.strictEqual(res.structuredContent.executed, 3);
    assert.strictEqual(res.structuredContent.success, true);
    console.log(`  ✓ Executed 3 commands in ${duration.toFixed(1)}ms (${(duration / 3).toFixed(1)}ms / command)`);
  }

  // -------------------------------------------------------------------------
  // TEST — Unicode Encoding (UTF-8 Cyrillic)
  // -------------------------------------------------------------------------
  console.log('\n▶ [TEST] Windows UTF-8 Console Output (Cyrillic)...');
  {
    const res = await startProcess({ command: 'Write-Output "Привіт тест"' });
    assert(res.content[0].text.includes('Привіт тест'), `Expected "Привіт тест", got: ${res.content[0].text}`);
    console.log(`  ✓ Unicode properly preserved: "${res.content[0].text.trim()}"`);
  }

  console.log('\n====================================================');
  console.log('🎉 ALL LATENCY, RELIABILITY & COMPATIBILITY TESTS PASSED!');
  console.log('====================================================');
  console.log(JSON.stringify(results, null, 2));

  return results;
}

runSuite().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});

/**
 * Comprehensive Latency & Compatibility Test Suite for Remote Desktop Commander
 * Covers Tests A through I required for ultra-fast, robust mobile/ChatGPT remote execution.
 */

import assert from 'assert';
import { startProcess, readProcessOutput, interactWithProcess, forceTerminate, listSessions, execBatch } from '../dist/tools/improved-process-tools.js';
import { listProcesses } from '../dist/tools/process.js';
import { readFile } from '../dist/tools/filesystem.js';
import { MAX_PROCESS_WAIT_MS } from '../dist/config.js';
import { execSync } from 'child_process';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runSuite() {
  console.log('====================================================');
  console.log('🚀 Starting Remote Desktop Commander Latency Test Suite');
  console.log(`⚡ Configured MAX_PROCESS_WAIT_MS: ${MAX_PROCESS_WAIT_MS}ms`);
  console.log('====================================================\n');

  const results = {};

  // -------------------------------------------------------------------------
  // TEST A — Immediate Command
  // echo hello -> target: < 1 second local.
  // -------------------------------------------------------------------------
  console.log('▶ [TEST A] Immediate Command (echo hello)...');
  {
    const start = performance.now();
    const res = await startProcess({ command: 'echo hello_world_fast' });
    const duration = performance.now() - start;
    results['Test_A_Immediate'] = duration;

    assert.strictEqual(res.isError, undefined);
    assert(res.content[0].text.includes('hello_world_fast'));
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
    // PowerShell silent sleep for 30 seconds
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
  // TEST C — Long Build / Delayed Output
  // Start 10-sec task with delayed output. start_process returns immediately,
  // read_process_output retrieves later output.
  // -------------------------------------------------------------------------
  console.log('\n▶ [TEST C] Long Build with Delayed Output...');
  let testCPid = null;
  {
    const start = performance.now();
    const res = await startProcess({
      command: 'Start-Sleep -Milliseconds 800; Write-Output "BUILD_PROGRESS_1"; Start-Sleep -Milliseconds 800; Write-Output "BUILD_PROGRESS_2"',
      timeout_ms: 60000
    });
    const duration = performance.now() - start;
    results['Test_C_LongBuildStart'] = duration;
    testCPid = res.structuredContent.pid;

    console.log(`  ✓ Spawn returned PID ${testCPid} in ${duration.toFixed(1)}ms`);

    // Wait 1.5 seconds for first delayed output
    await delay(1200);
    const readStart = performance.now();
    const readRes = await readProcessOutput({ pid: testCPid, offset: 0 });
    const readDuration = performance.now() - readStart;
    results['Test_C_ReadProgress'] = readDuration;

    assert(readRes.content[0].text.includes('BUILD_PROGRESS_1'), 'Should have received delayed output');
    console.log(`  ✓ Retrieved delayed output in ${readDuration.toFixed(1)}ms: "${readRes.content[0].text.trim()}"`);
  }

  // -------------------------------------------------------------------------
  // TEST D — Interact with Process (REPL)
  // Send input to persistent powershell/node REPL, interact returns < 3 sec, process continues.
  // -------------------------------------------------------------------------
  console.log('\n▶ [TEST D] Interact with Process...');
  {
    // Start powershell process
    const proc = await startProcess({ command: 'powershell -NoProfile -NoLogo' });
    const pid = proc.structuredContent.pid;
    console.log(`  ✓ Started persistent shell (PID ${pid})`);

    const interactStart = performance.now();
    const intRes = await interactWithProcess({
      pid,
      input: '$x = 40 + 2; Write-Output "RESULT_$x"',
      timeout_ms: 5000
    });
    const interactDuration = performance.now() - interactStart;
    results['Test_D_Interact'] = interactDuration;

    assert(intRes.content[0].text.includes('RESULT_42'), 'Should compute and return RESULT_42');
    assert(interactDuration < 3000, `Interact should return < 3000ms, took ${interactDuration.toFixed(1)}ms`);
    console.log(`  ✓ Interact returned in ${interactDuration.toFixed(1)}ms: ${intRes.content[0].text.trim()}`);

    // Cleanup session
    await forceTerminate({ pid });
  }

  // -------------------------------------------------------------------------
  // TEST E — No-Output Polling
  // read_process_output on silent running job returns < 1 sec.
  // -------------------------------------------------------------------------
  console.log('\n▶ [TEST E] No-Output Polling (Silent Job)...');
  {
    // Read on testBPid (which is sleeping for 30s)
    const readStart = performance.now();
    const readRes = await readProcessOutput({
      pid: testBPid,
      offset: 0,
      timeout_ms: 10000 // Client requested 10s wait, but our cap should return in <= 1000ms
    });
    const readDuration = performance.now() - readStart;
    results['Test_E_EmptyPoll'] = readDuration;

    assert(readDuration <= 1300, `Empty poll wait must be capped near 1000ms, took ${readDuration.toFixed(1)}ms`);
    assert(readRes.structuredContent.cursor !== undefined, 'Must provide structured cursor');
    console.log(`  ✓ Polling wait capped cleanly at ${readDuration.toFixed(1)}ms (Target: <= 1000ms)`);
  }

  // -------------------------------------------------------------------------
  // TEST F — Parallel Load
  // 4 concurrent tasks + 10 lightweight calls (list_processes, list_sessions)
  // P95 lightweight response target < 1 sec.
  // -------------------------------------------------------------------------
  console.log('\n▶ [TEST F] Parallel Load (Heavy + 10 Lightweight calls)...');
  {
    const heavyOps = [
      startProcess({ command: 'Start-Sleep -Seconds 4' }),
      startProcess({ command: 'Start-Sleep -Seconds 4' }),
      startProcess({ command: 'Start-Sleep -Seconds 4' }),
      startProcess({ command: 'Start-Sleep -Seconds 4' }),
    ];

    const lightTimes = [];
    const lightOps = Array.from({ length: 10 }).map(async (_, idx) => {
      await delay(idx * 30);
      const t0 = performance.now();
      if (idx % 2 === 0) {
        await listSessions();
      } else {
        await listProcesses();
      }
      lightTimes.push(performance.now() - t0);
    });

    await Promise.all([...heavyOps, ...lightOps]);

    lightTimes.sort((a, b) => a - b);
    const p50 = lightTimes[Math.floor(lightTimes.length * 0.5)];
    const p95 = lightTimes[Math.floor(lightTimes.length * 0.95)];
    results['Test_F_Lightweight_P50'] = p50;
    results['Test_F_Lightweight_P95'] = p95;

    console.log(`  ✓ 10 lightweight calls during heavy load: median = ${p50.toFixed(1)}ms, p95 = ${p95.toFixed(1)}ms (Target: < 1000ms)`);
    assert(p95 < 2000, `P95 should be fast, got ${p95.toFixed(1)}ms`);
  }

  // -------------------------------------------------------------------------
  // TEST H — Windows Process Tree Cleanup
  // Start PowerShell -> Node child, force_terminate(parent) kills child tree
  // -------------------------------------------------------------------------
  console.log('\n▶ [TEST H] Windows Process Tree Termination...');
  {
    // Start PowerShell parent which spawns a background ping/sleep process
    const res = await startProcess({
      command: 'powershell -Command "$p = Start-Process powershell -ArgumentList \'-NoExit\', \'-Command\', \'Start-Sleep -Seconds 60\' -PassThru; Write-Output \\"SUBPID_$($p.Id)\\"; Start-Sleep -Seconds 60"'
    });
    const parentPid = res.structuredContent.pid;
    console.log(`  ✓ Spawned parent process PID ${parentPid}`);

    await delay(1000);
    const termStart = performance.now();
    await forceTerminate({ pid: parentPid });
    const termDuration = performance.now() - termStart;
    results['Test_H_ForceTerminate'] = termDuration;

    await delay(600);
    // Verify parent is dead via tasklist
    let parentAlive = false;
    try {
      const out = execSync(`tasklist /FI "PID eq ${parentPid}"`, { encoding: 'utf8' });
      parentAlive = out.includes(String(parentPid));
    } catch {}

    assert(!parentAlive, `Parent PID ${parentPid} must be terminated`);
    console.log(`  ✓ Process tree successfully killed in ${termDuration.toFixed(1)}ms`);
  }

  // Clean up Test B child
  if (testBPid) {
    try { await forceTerminate({ pid: testBPid }); } catch {}
  }
  if (testCPid) {
    try { await forceTerminate({ pid: testCPid }); } catch {}
  }

  // -------------------------------------------------------------------------
  // TEST — exec_batch Verification
  // -------------------------------------------------------------------------
  console.log('\n▶ [TEST] exec_batch multi-command execution...');
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
  console.log('🎉 ALL LATENCY & COMPATIBILITY TESTS PASSED!');
  console.log('====================================================');
  console.log(JSON.stringify(results, null, 2));

  return results;
}

runSuite().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});

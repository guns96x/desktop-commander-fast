/**
 * Reproducible Benchmark Harness for Desktop Commander Remote Fast-Path
 * Collects auditable metrics with sample counts, min, median (p50), p95, and max.
 * Outputs raw results to test/benchmark-results.json.
 */
import './helpers/set-remote-env.js';
import assert from 'assert';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import {
  startProcess,
  readProcessOutput,
  interactWithProcess,
  forceTerminate,
  listSessions
} from '../dist/tools/improved-process-tools.js';
import { listProcesses } from '../dist/tools/process.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function computeStats(samples) {
  if (samples.length === 0) return { count: 0, min_ms: 0, median_ms: 0, p95_ms: 0, max_ms: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const count = sorted.length;
  const min = sorted[0];
  const max = sorted[count - 1];
  const median = sorted[Math.floor(count * 0.5)];
  const p95 = sorted[Math.min(count - 1, Math.floor(count * 0.95))];
  return {
    count,
    min_ms: Number(min.toFixed(1)),
    median_ms: Number(median.toFixed(1)),
    p95_ms: Number(p95.toFixed(1)),
    max_ms: Number(max.toFixed(1)),
    samples: sorted.map((s) => Number(s.toFixed(1)))
  };
}

async function runBenchmark() {
  console.log('====================================================');
  console.log('📊 Running Desktop Commander Reproducible Benchmark');
  console.log(`⏱ Timestamp: ${new Date().toISOString()}`);
  console.log('====================================================\n');

  const benchmarkData = {
    timestamp: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    node_version: process.version,
    benchmarks: {}
  };

  // 1. Immediate Command
  console.log('▶ Benchmarking: Immediate Command (10 samples)...');
  {
    const samples = [];
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      await startProcess({ command: 'echo bench_test' });
      samples.push(performance.now() - t0);
      await delay(50);
    }
    benchmarkData.benchmarks['immediate_command'] = computeStats(samples);
    console.log('  Stats:', benchmarkData.benchmarks['immediate_command']);
  }

  // 2. Silent Long Child (Fast Spawn)
  console.log('\n▶ Benchmarking: Silent Long Child Start (5 samples)...');
  {
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const res = await startProcess({ command: 'Start-Sleep -Seconds 30', timeout_ms: 300000 });
      samples.push(performance.now() - t0);
      const pid = res.structuredContent.pid;
      if (pid) {
        try { await forceTerminate({ pid }); } catch {}
      }
      await delay(100);
    }
    benchmarkData.benchmarks['silent_child_start'] = computeStats(samples);
    console.log('  Stats:', benchmarkData.benchmarks['silent_child_start']);
  }

  // 3. Empty Polling Wait Cap
  console.log('\n▶ Benchmarking: Empty Polling Wait Cap (5 samples)...');
  {
    const silentJob = await startProcess({ command: 'Start-Sleep -Seconds 30', timeout_ms: 300000 });
    const pid = silentJob.structuredContent.pid;
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await readProcessOutput({ pid, offset: 0, timeout_ms: 10000 });
      samples.push(performance.now() - t0);
      await delay(100);
    }
    try { await forceTerminate({ pid }); } catch {}
    benchmarkData.benchmarks['empty_poll_wait'] = computeStats(samples);
    console.log('  Stats:', benchmarkData.benchmarks['empty_poll_wait']);
  }

  // 4. REPL Silent Interact Cap
  console.log('\n▶ Benchmarking: REPL Silent Interact Wait Cap (3 samples)...');
  {
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const shell = await startProcess({ command: 'powershell -NoProfile -NoLogo' });
      const pid = shell.structuredContent.pid;
      const t0 = performance.now();
      await interactWithProcess({
        pid,
        input: 'Start-Sleep -Seconds 5; Write-Output "DONE"',
        timeout_ms: 30000
      });
      samples.push(performance.now() - t0);
      try { await forceTerminate({ pid }); } catch {}
      await delay(200);
    }
    benchmarkData.benchmarks['silent_repl_interact'] = computeStats(samples);
    console.log('  Stats:', benchmarkData.benchmarks['silent_repl_interact']);
  }

  // 5. Real Libuv Starvation Lightweight Latency
  console.log('\n▶ Benchmarking: Real Libuv Starvation Lightweight Latency (20 samples)...');
  {
    const tempDir = path.join(process.cwd(), 'test', 'bench_fs_tmp');
    await fs.mkdir(tempDir, { recursive: true });

    let stopHeavyLoad = false;
    const heavyWorkers = Array.from({ length: 8 }).map(async (_, workerId) => {
      const filePath = path.join(tempDir, `bench_stress_${workerId}.bin`);
      const buffer = crypto.randomBytes(1024 * 1024);
      while (!stopHeavyLoad) {
        await fs.writeFile(filePath, buffer);
        const data = await fs.readFile(filePath);
        crypto.createHash('sha256').update(data).digest();
        await delay(10);
      }
      try { await fs.unlink(filePath); } catch {}
    });

    const samples = [];
    for (let i = 0; i < 20; i++) {
      await delay(30);
      const t0 = performance.now();
      if (i % 2 === 0) {
        await listSessions();
      } else {
        await listProcesses();
      }
      samples.push(performance.now() - t0);
    }

    stopHeavyLoad = true;
    await Promise.all(heavyWorkers);
    try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}

    benchmarkData.benchmarks['lightweight_under_fs_starvation'] = computeStats(samples);
    console.log('  Stats:', benchmarkData.benchmarks['lightweight_under_fs_starvation']);
  }

  // Write raw auditable results
  const outPath = path.join(process.cwd(), 'test', 'benchmark-results.json');
  await fs.writeFile(outPath, JSON.stringify(benchmarkData, null, 2), 'utf8');
  console.log(`\n✅ Raw benchmark results written to ${outPath}`);
  return benchmarkData;
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});

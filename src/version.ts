import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

export const VERSION = '0.2.51';
export const FORK_REVISION = 'fast-1.0.0';
export const FAST_PROFILE_VERSION = 'fast-1.0.0';

export function getBuildCommit(): string {
  if (process.env.BUILD_COMMIT) {
    return process.env.BUILD_COMMIT.trim();
  }
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    return execSync('git rev-parse --short HEAD', {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000
    }).trim();
  } catch {
    return 'cf0e432';
  }
}

export const BUILD_COMMIT = getBuildCommit();

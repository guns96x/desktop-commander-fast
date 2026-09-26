import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 2000
  }).trim();
} catch (e) {
  if (process.env.BUILD_COMMIT) {
    commit = process.env.BUILD_COMMIT.trim();
  }
}

if (commit && commit !== 'unknown') {
  const versionFile = path.join(rootDir, 'src', 'version.ts');
  let content = readFileSync(versionFile, 'utf8');
  content = content.replace(/return '[0-9a-f]{7,40}';/, `return '${commit}';`);
  writeFileSync(versionFile, content, 'utf8');
  console.log(`[sync-build-commit] Embedded build commit ${commit} into src/version.ts`);
}

// Dimension: compile (weight .10)
// Runs `tsc --noEmit` against the generated workspace. This is a hard gate:
// code that doesn't typecheck can't have done what the task asked, no matter
// how good it looks statically.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PKG_ROOT } from '../../config.ts';
import type { DimensionResult, Diff } from '../../types.ts';
import type { GradeContext } from '../context.ts';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 120_000;
const MAX_ERROR_LINES = 20;

// Resolve TypeScript's own JS entry rather than npm's .bin shim. The shim is a
// POSIX sh script plus a sibling .cmd wrapper, and Windows can spawn neither
// directly (ENOENT for the extensionless script, EINVAL for the .cmd unless a
// shell is involved). Running the entry with the current node binary sidesteps
// shims entirely and behaves identically on every platform.
function resolveTscEntry(workspaceDir: string): string {
  for (const dir of [workspaceDir, PKG_ROOT]) {
    const candidate = join(dir, 'node_modules', 'typescript', 'bin', 'tsc');
    if (existsSync(candidate)) return candidate;
  }
  return join(PKG_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
}

export async function gradeCompile(ctx: GradeContext): Promise<DimensionResult> {
  const tscEntry = resolveTscEntry(ctx.workspaceDir);
  const tsconfigPath = join(ctx.workspaceDir, 'tsconfig.json');

  try {
    await execFileAsync(process.execPath, [tscEntry, '--noEmit', '-p', tsconfigPath], {
      cwd: ctx.workspaceDir,
      timeout: TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { dimension: 'compile', score: 100, gate: 'pass', diffs: [] };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; killed?: boolean; signal?: string; message?: string };
    const output = `${e.stdout ?? ''}\n${e.stderr ?? ''}`.trim();
    const lines =
      output.length > 0
        ? output.split('\n').filter((l) => l.trim().length > 0)
        : [`tsc failed with no output${e.message ? ` (${e.message})` : ''}`];
    const timedOut = e.killed === true || e.signal === 'SIGTERM';

    const diffs: Diff[] = (timedOut ? ['tsc timed out after 120s'] : lines.slice(0, MAX_ERROR_LINES)).map((line) => ({
      dimension: 'compile',
      message: line,
    }));

    return { dimension: 'compile', score: 0, gate: 'fail', diffs };
  }
}

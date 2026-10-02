// Dimension: compile (weight .10)
// Runs `tsc --noEmit` against the generated workspace. This is a hard gate:
// code that doesn't typecheck can't have done what the task asked, no matter
// how good it looks statically.
//
// An Angular cell (SystemConfig.framework 'angular') runs the Angular
// compiler (`ngc`, strictTemplates) instead, so its templates are checked as
// well as its TypeScript. Angular does not type-check attributes on a custom
// element, though: CUSTOM_ELEMENTS_SCHEMA admits any. A React cell catches an
// invented value (`variant="danger"` where the element accepts
// 'primary' | 'secondary') because the generated JSX declarations type it, so
// for parity an Angular cell's static values are checked against the catalog
// here, with the same notion of a trustworthy type (isSelfContainedType).

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PKG_ROOT } from '../../config.ts';
import { isSelfContainedType } from '../../run/fixture.ts';
import type { DimensionResult, Diff, SystemCatalog } from '../../types.ts';
import type { StaticAttrValue } from '../angular.ts';
import type { GradeContext } from '../context.ts';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 120_000;
const MAX_ERROR_LINES = 20;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*m/g;

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

/** The Angular compiler's JS entry, for the same reason resolveTscEntry avoids the shim. */
function resolveNgcEntry(workspaceDir: string): string {
  return join(workspaceDir, 'node_modules', '@angular', 'compiler-cli', 'bundles', 'src', 'bin', 'ngc.js');
}

function stringLiteralUnion(type: string): string[] | undefined {
  if (!isSelfContainedType(type)) return undefined;
  const members = type.split('|').map((m) => m.trim());
  const strings: string[] = [];
  for (const m of members) {
    const quoted = /^(["'])(.*)\1$/.exec(m);
    // Any non-literal member (string, boolean, a number) means a free value is
    // acceptable, so there is nothing to check.
    if (!quoted) return undefined;
    strings.push(quoted[2]);
  }
  return strings;
}

/** Static values on design-system elements that the element's declared type rejects. */
export function invalidStaticValues(values: StaticAttrValue[], catalog: SystemCatalog): Diff[] {
  const types = new Map<string, string>();
  for (const comp of catalog.components) {
    for (const exp of comp.exports) {
      for (const prop of exp.props) {
        const camel = prop.name.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
        const kebab = prop.name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
        for (const alias of [prop.name, camel, kebab]) {
          const key = `${exp.displayName}\u0000${alias}`;
          if (!types.has(key)) types.set(key, prop.type);
        }
      }
    }
  }
  const diffs: Diff[] = [];
  for (const v of values) {
    const type = types.get(`${v.tag}\u0000${v.attr}`);
    if (!type) continue;
    const allowed = stringLiteralUnion(type);
    if (!allowed || allowed.includes(v.value)) continue;
    diffs.push({
      dimension: 'compile',
      message: `${v.path}:${v.line}: <${v.tag} ${v.attr}="${v.value}">: '${v.value}' is not one of ${allowed.map((a) => `'${a}'`).join(' | ')}`,
    });
  }
  return diffs;
}

function failureDiffs(err: unknown, tool: string): Diff[] {
  const e = err as { stdout?: string; stderr?: string; killed?: boolean; signal?: string; message?: string };
  const output = `${e.stdout ?? ''}\n${e.stderr ?? ''}`.replace(ANSI_RE, '').trim();
  const lines =
    output.length > 0
      ? output.split('\n').filter((l) => l.trim().length > 0)
      : [`${tool} failed with no output${e.message ? ` (${e.message})` : ''}`];
  const timedOut = e.killed === true || e.signal === 'SIGTERM';
  return (timedOut ? [`${tool} timed out after 120s`] : lines.slice(0, MAX_ERROR_LINES)).map((line) => ({
    dimension: 'compile',
    message: line,
  }));
}

export async function gradeCompile(ctx: GradeContext): Promise<DimensionResult> {
  const angular = ctx.systemCfg.framework === 'angular';
  const entry = angular ? resolveNgcEntry(ctx.workspaceDir) : resolveTscEntry(ctx.workspaceDir);
  const tool = angular ? 'ngc' : 'tsc';
  const tsconfigPath = join(ctx.workspaceDir, 'tsconfig.json');
  // ngc reads noEmit from the fixture's tsconfig and rejects --noEmit as a flag.
  const args = angular ? [entry, '-p', tsconfigPath] : [entry, '--noEmit', '-p', tsconfigPath];

  try {
    await execFileAsync(process.execPath, args, {
      cwd: ctx.workspaceDir,
      timeout: TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err: unknown) {
    return { dimension: 'compile', score: 0, gate: 'fail', diffs: failureDiffs(err, tool) };
  }

  if (angular && ctx.angular) {
    const diffs = invalidStaticValues(ctx.angular.staticValues, ctx.catalog);
    if (diffs.length > 0) return { dimension: 'compile', score: 0, gate: 'fail', diffs: diffs.slice(0, MAX_ERROR_LINES) };
  }
  return { dimension: 'compile', score: 100, gate: 'pass', diffs: [] };
}

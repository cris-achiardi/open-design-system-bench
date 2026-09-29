// agentContext injection: the agents-md / skill context levels resolve their
// source files against the system root, and an ABSOLUTE entry is honoured as
// written. Offline: a synthetic template dir (with a node_modules to satisfy
// the prepared-template check) and tmp dirs only, no npm and no real system.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { provisionWorkspace } from './fixture.ts';
import type { SystemCatalog, SystemConfig } from '../types.ts';

/** provisionWorkspace requires a catalog; these docgen-model tests never read it. */
const EMPTY_CATALOG: SystemCatalog = {
  system: 'acme',
  generatedAt: new Date(0).toISOString(),
  source: { root: '', commit: 'test', srcHash: 'test' },
  components: [],
  allExports: [],
  allPropsByExport: {},
};

/** A minimal template dir that passes provisionWorkspace's prepared check. */
function makeTemplate(): string {
  const dir = mkdtempSync(join(tmpdir(), 'odsys-ctx-tpl-'));
  mkdirSync(join(dir, 'node_modules'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'task.tsx'), 'export const TaskScreen = () => null;\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
  return dir;
}

function baseConfig(root: string, templateDir: string, overrides: Partial<SystemConfig> = {}): SystemConfig {
  return {
    root,
    rootEnv: 'OPEN_DESIGN_SYSTEM_BENCH_ACME_DIR',
    componentsSrc: 'src',
    componentsPkg: '@acme/ui',
    foundationsPkg: '@acme/ui',
    catalogStrategy: 'docgen',
    fixtureTemplate: templateDir,
    agentContext: { agentsMd: [] },
    ...overrides,
  };
}

test('an absolute agentsMd path is read as written, not joined onto the system root', async () => {
  const systemRoot = mkdtempSync(join(tmpdir(), 'odsys-ctx-root-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'odsys-ctx-gen-'));
  const template = makeTemplate();
  const dest = join(mkdtempSync(join(tmpdir(), 'odsys-ctx-ws-')), 'workspace');

  // The document lives OUTSIDE the system checkout — the astryx shape, where
  // the consumer-facing agent block is generated into a consuming project by
  // `astryx init` rather than committed to the design system's own repo.
  const generated = join(elsewhere, 'CONSUMER.md');
  writeFileSync(generated, '# consumer block\nuse the components\n');

  try {
    await provisionWorkspace({
      system: 'acme',
      systemCfg: baseConfig(systemRoot, template, { agentContext: { agentsMd: [generated] } }),
      context: 'agents-md',
      destDir: dest,
      catalog: EMPTY_CATALOG,
    });

    assert.equal(readFileSync(join(dest, 'AGENTS.md'), 'utf8'), '# consumer block\nuse the components\n');
    assert.equal(readFileSync(join(dest, 'CLAUDE.md'), 'utf8'), '# consumer block\nuse the components\n');
  } finally {
    for (const d of [systemRoot, elsewhere, template, dest]) rmSync(d, { recursive: true, force: true });
  }
});

test('a relative agentsMd path still resolves against the system root', async () => {
  const systemRoot = mkdtempSync(join(tmpdir(), 'odsys-ctx-root-'));
  const template = makeTemplate();
  const dest = join(mkdtempSync(join(tmpdir(), 'odsys-ctx-ws-')), 'workspace');
  writeFileSync(join(systemRoot, 'AGENTS.md'), '# in-repo guidance\n');

  try {
    await provisionWorkspace({
      system: 'acme',
      systemCfg: baseConfig(systemRoot, template, { agentContext: { agentsMd: ['AGENTS.md'] } }),
      context: 'agents-md',
      destDir: dest,
      catalog: EMPTY_CATALOG,
    });

    assert.equal(readFileSync(join(dest, 'AGENTS.md'), 'utf8'), '# in-repo guidance\n');
  } finally {
    for (const d of [systemRoot, template, dest]) rmSync(d, { recursive: true, force: true });
  }
});

test('absolute extraDocs land in the workspace docs/ dir at the skill level only', async () => {
  const systemRoot = mkdtempSync(join(tmpdir(), 'odsys-ctx-root-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'odsys-ctx-gen-'));
  const template = makeTemplate();
  const skillDest = join(mkdtempSync(join(tmpdir(), 'odsys-ctx-ws-')), 'workspace');
  const agentsMdDest = join(mkdtempSync(join(tmpdir(), 'odsys-ctx-ws-')), 'workspace');

  writeFileSync(join(elsewhere, 'CONSUMER.md'), '# consumer block\n');
  writeFileSync(join(elsewhere, 'tokens.md'), '# tokens\n');

  const cfg = baseConfig(systemRoot, template, {
    agentContext: {
      agentsMd: [join(elsewhere, 'CONSUMER.md')],
      extraDocs: [join(elsewhere, 'tokens.md')],
    },
  });

  try {
    await provisionWorkspace({ system: 'acme', systemCfg: cfg, context: 'skill', destDir: skillDest, catalog: EMPTY_CATALOG });
    assert.equal(readFileSync(join(skillDest, 'docs', 'tokens.md'), 'utf8'), '# tokens\n');

    await provisionWorkspace({ system: 'acme', systemCfg: cfg, context: 'agents-md', destDir: agentsMdDest, catalog: EMPTY_CATALOG });
    assert.ok(!existsSync(join(agentsMdDest, 'docs', 'tokens.md')), 'extraDocs are the skill level, not agents-md');
  } finally {
    for (const d of [systemRoot, elsewhere, template, skillDest, agentsMdDest]) {
      rmSync(d, { recursive: true, force: true });
    }
  }
});

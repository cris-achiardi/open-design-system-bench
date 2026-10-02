// framework 'angular': template selection, placeholder substitution in the
// Angular template's own files, and the element reference it gets instead of
// JSX declarations. Offline, like fixture-source.test.ts: no install.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { copyTemplate, renderAngularElementTypes, substitutePlaceholders, templateDir } from './fixture.ts';
import { paths } from '../config.ts';
import type { SystemCatalog, SystemConfig } from '../types.ts';

const cfg: SystemConfig = {
  root: 'C:\\repos\\acme',
  rootEnv: 'ACME_DIR',
  componentsSrc: 'packages/web/src',
  componentsPkg: '@acme/web',
  foundationsPkg: '@acme/web',
  foundationsCss: 'packages/web/dist/tokens.css',
  catalogStrategy: 'catalog-json',
  componentModel: 'custom-elements',
  framework: 'angular',
  agentContext: { agentsMd: [] },
};

test('an angular system resolves to the generic Angular template', () => {
  assert.equal(templateDir('acme-no-local-template', cfg), join(paths.fixturesDir, 'custom-elements-angular-app'));
});

test('framework angular is refused without componentModel custom-elements, or in npm mode', () => {
  assert.throws(() => templateDir('x', { ...cfg, componentModel: 'react' }), /requires componentModel "custom-elements"/);
  assert.throws(() => templateDir('x', { ...cfg, consume: 'npm' }), /supports consume "source" only/);
});

test('the Angular template has its registry import, styles and serve alias filled in', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ng-fixture-'));
  try {
    copyTemplate(join(paths.fixturesDir, 'custom-elements-angular-app'), dir);
    substitutePlaceholders(dir, cfg);
    assert.ok(readFileSync(join(dir, 'src', 'main.ts'), 'utf8').includes("import '@acme/web';"));
    assert.ok(readFileSync(join(dir, 'src', 'system-module.d.ts'), 'utf8').includes("declare module '@acme/web';"));
    assert.ok(readFileSync(join(dir, 'angular.json'), 'utf8').includes('"C:/repos/acme/packages/web/dist/tokens.css"'));
    const serve = readFileSync(join(dir, 'tsconfig.serve.json'), 'utf8');
    assert.ok(serve.includes('"@acme/web": ["C:/repos/acme/packages/web/src/index.ts"]'), serve);
    assert.ok(!readFileSync(join(dir, 'tsconfig.json'), 'utf8').includes('"paths"'), 'the checked program must not alias the library source');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renderAngularElementTypes declares each element with its typed attributes, no React', () => {
  const catalog: SystemCatalog = {
    system: 'acme',
    generatedAt: '',
    source: { root: '', commit: '', srcHash: '' },
    components: [
      {
        dir: 'button',
        exports: [{ displayName: 'ds-button', description: 'A button', props: [{ name: 'variant', type: "'a' | 'b'", required: false, description: '' }] }],
      },
    ],
    allExports: ['ds-button', 'DsButton'],
    allPropsByExport: { 'ds-button': ['variant', 'onClick'] },
  };
  const out = renderAngularElementTypes(catalog);
  assert.ok(out.includes('"ds-button": HTMLElement & {'), out);
  assert.ok(out.includes(`"variant"?: 'a' | 'b';`), out);
  assert.ok(out.includes('"onClick"?: unknown;'), out);
  assert.ok(!out.includes('DsButton'), 'only dashed tags are elements');
  assert.ok(!out.includes('react'), out);
});

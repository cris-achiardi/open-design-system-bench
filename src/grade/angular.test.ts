import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { SystemCatalog, SystemConfig, SystemTokens, Task } from '../types.ts';
import { analyzeAngularFiles, findComponents, stylesheetDeclarations, templateToJsx } from './angular.ts';
import type { GradeContext } from './context.ts';
import { gradeA11yStatic } from './mechanical/a11y-static.ts';
import { gradeApiFidelity } from './mechanical/api-fidelity.ts';
import { invalidStaticValues } from './mechanical/compile.ts';
import { gradeImports } from './mechanical/imports.ts';
import { gradeTokenDiscipline } from './mechanical/token-discipline.ts';

const catalog: SystemCatalog = {
  system: 'acme',
  generatedAt: new Date().toISOString(),
  source: { root: '/fake', commit: 'x', srcHash: 'x' },
  components: [
    {
      dir: 'button',
      exports: [
        {
          displayName: 'ds-button',
          description: 'A button',
          props: [
            { name: 'variant', type: "'primary' | 'secondary'", required: false, description: '' },
            { name: 'with-caret', type: 'boolean', required: false, description: '' },
          ],
        },
      ],
    },
    {
      dir: 'switch',
      exports: [{ displayName: 'ds-switch', description: 'A switch', props: [{ name: 'checked', type: 'boolean', required: false, description: '' }] }],
    },
  ],
  allExports: ['ds-button', 'ds-switch'],
  allPropsByExport: { 'ds-button': ['variant', 'with-caret'], 'ds-switch': ['checked'] },
};

const tokens: SystemTokens = { system: 'acme', generatedAt: '', cssVars: [], utilities: [], typographyUtilities: [], cssHash: 'x' };

const cfg: SystemConfig = {
  root: '/fake',
  rootEnv: 'ACME_DIR',
  componentsSrc: 'src/components',
  componentsPkg: '@acme/elements',
  foundationsPkg: '@acme/elements',
  catalogStrategy: 'catalog-json',
  componentModel: 'custom-elements',
  framework: 'angular',
  agentContext: { agentsMd: [] },
  a11y: { controls: ['ds-switch'], interactive: ['ds-button'], childrenNamed: ['ds-switch'] },
};

const task: Task = { id: 't', title: 't', systems: ['acme'], prompt: 'p', hiddenExpectations: { componentsAnyOf: {} }, rubrics: [] };

function ctxFor(raw: Array<{ path: string; source: string }>): GradeContext {
  const { files, staticValues, templateErrors } = analyzeAngularFiles(raw);
  return { system: 'acme', systemCfg: cfg, catalog, tokens, task, files, workspaceDir: '/fake/ws', angular: { staticValues, templateErrors } };
}

const component = (template: string, extra = '') => `import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

@Component({
  selector: 'task-screen',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: \`${template}\`,${extra}
})
export class TaskComponent {
  save() {}
}
`;

test('findComponents reads an inline template, templateUrl and styles', () => {
  const metas = findComponents(component('<p>Hi</p>', "\n  styles: ['p { margin: 4px; }'],\n  styleUrl: './task.component.css',"));
  assert.equal(metas.length, 1);
  assert.equal(metas[0].template?.text, '<p>Hi</p>');
  assert.equal(metas[0].template?.line, 6);
  assert.deepEqual(metas[0].styleUrls, ['./task.component.css']);
  assert.equal(metas[0].styles[0].text, 'p { margin: 4px; }');
});

test('templateToJsx keeps elements on their source lines and maps bindings', () => {
  const { source } = templateToJsx(
    '<ds-button variant="primary" (click)="save()" (keydown.enter)="save()">\n  Save {{ n }}\n</ds-button>\n<label for="e">E</label>',
    10,
    'x.ts',
  );
  const lines = source.split('\n');
  assert.ok(lines[9].includes('<ds-button variant="primary" onClick={__ng} onKeyDown={__ng}>'), source);
  assert.ok(lines[12].includes('<label htmlFor="e">'), source);
  assert.ok(source.includes('{__ng}'), 'interpolation becomes an opaque expression');
});

test('templateToJsx renders control flow, structural directives and ng-container as their content', () => {
  const { source } = templateToJsx(
    '@if (on) {<ds-switch>A</ds-switch>} @else {<p>off</p>}<div *ngIf="x"><ng-container><span>s</span></ng-container></div>@for (i of xs; track i) {<li>{{ i }}</li>} @empty {<li>none</li>}',
    1,
    'x.ts',
  );
  for (const tag of ['<ds-switch>', '<p>', '<div>', '<span>', '<li>']) assert.ok(source.includes(tag), `${tag} in ${source}`);
  assert.ok(!source.includes('ng-container'));
});

test('templateToJsx folds static style and [style.x] bindings into a style object', () => {
  const { source } = templateToJsx('<div style="margin: 2rem auto; color: #fff" [style.gap.px]="8"></div>', 1, 'x.ts');
  assert.ok(source.includes(`style={{"margin": "2rem auto", "color": "#fff", "gap": "8px"}}`), source);
});

test('stylesheetDeclarations reads declarations inside rules only, with their lines', () => {
  const decls = stylesheetDeclarations('/* a: 1px; */\n:host { display: block; }\n.row:hover {\n  padding: 12px;\n}', 5);
  assert.deepEqual(
    decls.map((d) => [d.prop, d.value, d.line]),
    [
      ['display', 'block', 6],
      ['padding', '12px', 8],
    ],
  );
});

test('an Angular cell is graded like the equivalent React cell', () => {
  const ctx = ctxFor([
    {
      path: 'src/task/task.component.ts',
      source: component('<ds-switch [checked]="on">Email digests</ds-switch><ds-button variant="primary" (click)="save()">Save</ds-button>'),
    },
  ]);
  assert.equal(gradeImports(ctx).gate, 'pass', 'Angular imports are allowed in an Angular cell');
  const api = gradeApiFidelity(ctx);
  assert.equal(api.score, 100, JSON.stringify(api.diffs));
  const a11y = gradeA11yStatic(ctx);
  return a11y.then((r) => assert.equal(r.gate, 'pass', JSON.stringify(r.diffs)));
});

test('invented attributes, unlabelled controls and raw values are caught through the template', async () => {
  const ctx = ctxFor([
    {
      path: 'src/task/task.component.ts',
      source: component('<ds-switch></ds-switch><ds-button tone="loud">Go</ds-button>', "\n  styleUrl: './task.component.css',"),
    },
    { path: 'src/task/task.component.css', source: ':host {\n  padding: 24px;\n  color: #333;\n}\n' },
  ]);
  const api = gradeApiFidelity(ctx);
  assert.ok(api.diffs.some((d) => d.message.includes("Invented prop 'tone'")), JSON.stringify(api.diffs));
  const a11y = await gradeA11yStatic(ctx);
  assert.ok(a11y.diffs.some((d) => d.message.includes('<ds-switch> form control has no accessible name in src/task/task.component.ts:6')), JSON.stringify(a11y.diffs));
  const tok = gradeTokenDiscipline(ctx);
  assert.ok(tok.diffs.some((d) => d.message === "Stylesheet declaration padding: '24px' in src/task/task.component.css:2 bypasses design tokens"), JSON.stringify(tok.diffs));
  assert.ok(tok.diffs.some((d) => d.message.includes("color: '#333'")));
});

test('a templateUrl template is graded at its own path', async () => {
  const ctx = ctxFor([
    { path: 'src/task/task.component.ts', source: component('').replace("template: ``,", "templateUrl: './task.component.html',") },
    { path: 'src/task/task.component.html', source: '<h1>Settings</h1>\n<div (click)="save()">Open</div>\n' },
  ]);
  const a11y = await gradeA11yStatic(ctx);
  assert.ok(a11y.diffs.some((d) => d.message.includes('non-interactive <div> in src/task/task.component.html:2')), JSON.stringify(a11y.diffs));
});

test('invalidStaticValues rejects a value outside a literal union and ignores free types', () => {
  const diffs = invalidStaticValues(
    [
      { tag: 'ds-button', attr: 'variant', value: 'danger', path: 'a.ts', line: 3 },
      { tag: 'ds-button', attr: 'variant', value: 'primary', path: 'a.ts', line: 4 },
      { tag: 'ds-button', attr: 'with-caret', value: '', path: 'a.ts', line: 5 },
      { tag: 'ds-button', attr: 'title', value: 'anything', path: 'a.ts', line: 6 },
    ],
    catalog,
  );
  assert.deepEqual(
    diffs.map((d) => d.message),
    [`a.ts:3: <ds-button variant="danger">: 'danger' is not one of 'primary' | 'secondary'`],
  );
});

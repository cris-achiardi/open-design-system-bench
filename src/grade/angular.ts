// Angular cells (SystemConfig.framework 'angular'): makes an Angular
// component's template and styles gradeable by the same mechanical graders a
// React cell goes through.
//
// Every mechanical grader reads JSX. Rather than give each of them a second
// implementation, an Angular template is rendered as an equivalent JSX
// expression (a "shadow" source) and handed to them as one more AnalyzedFile:
//
//   <ds-button variant="danger" (click)="save()">Save</ds-button>
//     ->  <ds-button variant="danger" onClick={__ng}>Save</ds-button>
//
// The rendering keeps exactly what the graders look at - element names,
// attribute names, static attribute values, event handlers, text children,
// nesting - and replaces every Angular expression with an opaque `__ng`, which
// the graders already treat as "present, value unknown". Each element is
// placed on the line it occupies in the original file, so a finding's
// `path:line` points at the template the agent wrote.
//
// Styles are graded too, which a React cell's stylesheets are not. In React,
// raw values mostly arrive as inline `style={{...}}` objects, which
// tokenDiscipline reads. In Angular the idiomatic place is the component's
// `styles` / `styleUrl`, and an inline `style=""` is rare; leaving
// stylesheets unread would score every Angular cell 100 on tokenDiscipline
// whatever it wrote. Each declaration is reported as a stylesheet declaration.

import { parse } from '@babel/parser';
import { BindingType, ParsedEventType, parseTemplate } from '@angular/compiler';
// @babel/traverse ships as CJS; see ast.ts for the interop guard.
import _traverse from '@babel/traverse';
import { analyzeSource, type FileAnalysis } from './ast.ts';
import type { AnalyzedFile } from './context.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const traverse: any = (_traverse as any).default ?? _traverse;

/** A file collected from a cell, before analysis. Paths are relative to the collected files dir. */
export interface RawFile {
  path: string;
  source: string;
}

/** A static value an agent wrote on a design-system element, checked by the compile dimension. */
export interface StaticAttrValue {
  tag: string;
  attr: string;
  value: string;
  path: string;
  line: number;
}

interface ComponentMeta {
  template?: { text: string; line: number };
  templateUrl?: string;
  styles: Array<{ text: string; line: number }>;
  styleUrls: string[];
}

// ---------------------------------------------------------------------------
// @Component metadata
// ---------------------------------------------------------------------------

function literalText(node: any): string | undefined {
  if (!node) return undefined;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral') {
    return (node.quasis ?? []).map((q: any) => q.value?.cooked ?? q.value?.raw ?? '').join('');
  }
  return undefined;
}

/** The line a string or template literal's CONTENT starts on (after its opening quote). */
function contentLine(node: any): number {
  return node?.loc?.start.line ?? 1;
}

/** Every @Component({...}) in a TypeScript source, with its template and styles. */
export function findComponents(source: string): ComponentMeta[] {
  let ast;
  try {
    ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'decorators-legacy'], errorRecovery: true });
  } catch {
    return [];
  }
  const out: ComponentMeta[] = [];
  try {
    traverse(ast, {
      Decorator(p: any) {
        const expr = p.node.expression;
        if (expr?.type !== 'CallExpression' || expr.callee?.type !== 'Identifier' || expr.callee.name !== 'Component') return;
        const arg = expr.arguments[0];
        if (arg?.type !== 'ObjectExpression') return;
        const meta: ComponentMeta = { styles: [], styleUrls: [] };
        for (const prop of arg.properties) {
          if (prop.type !== 'ObjectProperty') continue;
          const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
          const value = prop.value;
          if (key === 'template') {
            const text = literalText(value);
            if (text !== undefined) meta.template = { text, line: contentLine(value) };
          } else if (key === 'templateUrl') {
            meta.templateUrl = literalText(value);
          } else if (key === 'styles') {
            const items = value.type === 'ArrayExpression' ? value.elements : [value];
            for (const item of items) {
              const text = literalText(item);
              if (text !== undefined) meta.styles.push({ text, line: contentLine(item) });
            }
          } else if (key === 'styleUrl') {
            const url = literalText(value);
            if (url) meta.styleUrls.push(url);
          } else if (key === 'styleUrls' && value.type === 'ArrayExpression') {
            for (const item of value.elements) {
              const url = literalText(item);
              if (url) meta.styleUrls.push(url);
            }
          }
        }
        out.push(meta);
      },
    });
  } catch {
    // Best-effort: a component we cannot read is graded as having no template.
  }
  return out;
}

// ---------------------------------------------------------------------------
// Template -> JSX
// ---------------------------------------------------------------------------

// DOM events whose React prop name is not a plain capitalisation. The
// a11yStatic grader looks for onKeyDown / onKeyUp / onKeyPress by name.
const EVENT_PROP: Record<string, string> = {
  keydown: 'onKeyDown',
  keyup: 'onKeyUp',
  keypress: 'onKeyPress',
  mousedown: 'onMouseDown',
  mouseup: 'onMouseUp',
  mouseenter: 'onMouseEnter',
  mouseleave: 'onMouseLeave',
  dblclick: 'onDoubleClick',
  focusin: 'onFocusIn',
  focusout: 'onFocusOut',
  contextmenu: 'onContextMenu',
};

// Static attributes whose JSX spelling the graders read under its React name.
const ATTR_PROP: Record<string, string> = {
  class: 'className',
  for: 'htmlFor',
  tabindex: 'tabIndex',
  autofocus: 'autoFocus',
};

const JSX_ATTR_NAME_RE = /^[A-Za-z_][\w-]*(:[\w-]+)?$/;

function eventProp(name: string): string | undefined {
  const base = name.split('.')[0];
  if (!base) return undefined;
  if (EVENT_PROP[base]) return EVENT_PROP[base];
  const pascal = base
    .split(/[-:]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('');
  return pascal ? `on${pascal}` : undefined;
}

function camelCase(cssProp: string): string {
  return cssProp.startsWith('--') ? cssProp : cssProp.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}

/** `margin: 0 auto; color: red` -> [['margin','0 auto'], ['color','red']]. */
function parseDeclarations(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const decl of text.split(';')) {
    const i = decl.indexOf(':');
    if (i <= 0) continue;
    const prop = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (prop && value) out.push([prop, value]);
  }
  return out;
}

function jsString(value: string): string {
  return JSON.stringify(value);
}

/** A static attribute value as JSX: a plain string where JSX allows one, else an expression. */
function jsxValue(value: string): string {
  return /["\r\n{}<>]/.test(value) ? `{${jsString(value)}}` : `"${value}"`;
}

function literalOf(ast: any): string | number | undefined {
  // ASTWithSource wraps the expression in `.ast`.
  const node = ast?.ast ?? ast;
  if (node?.constructor?.name !== 'LiteralPrimitive') return undefined;
  return typeof node.value === 'string' || typeof node.value === 'number' ? node.value : undefined;
}

function isElement(node: any): boolean {
  return typeof node?.name === 'string' && Array.isArray(node.attributes) && Array.isArray(node.outputs) && Array.isArray(node.children);
}

function isTemplate(node: any): boolean {
  return Array.isArray(node?.templateAttrs) && Array.isArray(node.children);
}

/** The child lists a control-flow block renders (@if branches, @for + @empty, @switch cases, @defer states). */
function blockChildGroups(node: any): any[][] {
  const groups: any[][] = [];
  if (Array.isArray(node.branches)) for (const b of node.branches) groups.push(b.children ?? []);
  if (Array.isArray(node.cases)) for (const c of node.cases) groups.push(c.children ?? []);
  if (Array.isArray(node.children)) groups.push(node.children);
  for (const key of ['empty', 'placeholder', 'loading', 'error']) {
    if (Array.isArray(node[key]?.children)) groups.push(node[key].children);
  }
  return groups;
}

class JsxWriter {
  out = '';
  line = 1;
  constructor(private readonly baseLine: number) {}

  write(text: string): void {
    this.out += text;
    this.line += (text.match(/\n/g) ?? []).length;
  }

  /** Pads with newlines until the cursor reaches the line a 0-based template line maps to. */
  seek(templateLine: number | undefined): void {
    if (templateLine === undefined) return;
    const target = this.baseLine + templateLine;
    while (this.line < target) this.write('\n');
  }
}

export interface ShadowResult {
  source: string;
  staticValues: StaticAttrValue[];
  errors: string[];
}

/**
 * Renders an Angular template as a TSX module whose JSX the mechanical
 * graders can read. `baseLine` is the 1-based line of the template's first
 * character in its file, so every element lands on its own line there.
 */
export function templateToJsx(template: string, baseLine: number, path: string): ShadowResult {
  const parsed = parseTemplate(template, path, { preserveWhitespaces: false });
  const errors = (parsed.errors ?? []).map((e: any) => String(e.msg ?? e));
  const staticValues: StaticAttrValue[] = [];
  // The header occupies lines 1-2; an element on line 1 or 2 of its file is
  // emitted as soon after as JSX allows.
  const w = new JsxWriter(baseLine);
  w.write('declare const __ng: any;\n');
  w.write('export const __template = (<>');

  const emitNodes = (nodes: any[]) => {
    for (const node of nodes) emitNode(node);
  };

  const emitFragment = (nodes: any[]) => {
    w.write('<>');
    emitNodes(nodes);
    w.write('</>');
  };

  const emitElement = (node: any) => {
    let name: string = node.name;
    // Namespaced SVG/MathML elements arrive as ':svg:path'.
    const ns = /^:\w+:(.+)$/.exec(name);
    if (ns) name = ns[1];
    if (name === 'ng-container' || name === 'ng-template') {
      emitFragment(node.children);
      return;
    }
    if (name === 'ng-content') return;

    w.seek(node.startSourceSpan?.start.line ?? node.sourceSpan?.start.line);
    w.write(`<${name}`);
    const seen = new Set<string>();
    const style: Array<[string, string]> = [];
    const attr = (jsxName: string, value: string | undefined, line: number | undefined) => {
      if (!JSX_ATTR_NAME_RE.test(jsxName) || seen.has(jsxName)) return;
      seen.add(jsxName);
      w.seek(line);
      w.write(value === undefined ? ` ${jsxName}` : ` ${jsxName}=${value}`);
    };
    const recordStatic = (attrName: string, value: string, line: number | undefined) => {
      if (name.includes('-')) staticValues.push({ tag: name, attr: attrName, value, path, line: baseLine + (line ?? 0) });
    };

    for (const a of node.attributes) {
      const line = a.sourceSpan?.start.line;
      if (a.name === 'style') {
        style.push(...parseDeclarations(a.value));
        continue;
      }
      const jsxName = ATTR_PROP[a.name] ?? a.name;
      if (jsxName === 'tabIndex' && /^-?\d+$/.test(a.value)) {
        attr(jsxName, `{${a.value}}`, line);
        continue;
      }
      attr(jsxName, a.value === '' ? undefined : jsxValue(a.value), line);
      recordStatic(a.name, a.value, line);
    }

    for (const input of node.inputs) {
      const line = input.sourceSpan?.start.line;
      const literal = literalOf(input.value);
      if (input.type === BindingType.Style) {
        if (literal !== undefined) style.push([input.name, `${literal}${input.unit ?? ''}`]);
        continue;
      }
      if (input.type === BindingType.Class || input.type === BindingType.Animation || input.type === BindingType.LegacyAnimation) {
        continue;
      }
      const jsxName = ATTR_PROP[input.name] ?? input.name;
      if (typeof literal === 'string') {
        attr(jsxName, jsxValue(literal), line);
        recordStatic(input.name, literal, line);
      } else if (typeof literal === 'number') {
        attr(jsxName, `{${literal}}`, line);
      } else {
        attr(jsxName, '{__ng}', line);
      }
    }

    for (const output of node.outputs) {
      if (output.type !== ParsedEventType.Regular) continue;
      const prop = eventProp(output.name);
      if (prop) attr(prop, '{__ng}', output.sourceSpan?.start.line);
    }

    if (node.references?.length) attr('ref', '{__ng}', node.references[0].sourceSpan?.start.line);

    if (style.length > 0) {
      const body = style.map(([k, v]) => `${jsString(camelCase(k))}: ${jsString(v)}`).join(', ');
      attr('style', `{{${body}}}`, undefined);
    }

    if (node.children.length === 0) {
      w.write(' />');
      return;
    }
    w.write('>');
    emitNodes(node.children);
    w.write(`</${name}>`);
  };

  const emitNode = (node: any) => {
    if (isElement(node)) {
      emitElement(node);
      return;
    }
    if (isTemplate(node)) {
      // A structural directive on an element (<div *ngIf>) wraps that element
      // as the template's only child; <ng-template> holds its content.
      emitFragment(node.children);
      return;
    }
    const kind = node?.constructor?.name;
    if (kind === 'Text') {
      if (node.value.trim()) w.write(`{${jsString(node.value)}}`);
      return;
    }
    if (kind === 'BoundText' || kind === 'Icu') {
      w.write('{__ng}');
      return;
    }
    const groups = blockChildGroups(node);
    for (const group of groups) emitFragment(group);
  };

  emitNodes(parsed.nodes ?? []);
  w.write('</>);\n');
  return { source: w.out, staticValues, errors };
}

// ---------------------------------------------------------------------------
// Styles -> stylesheet declarations
// ---------------------------------------------------------------------------

/** Declarations in a stylesheet, each with its 1-based line in the file. Comments are skipped. */
export function stylesheetDeclarations(css: string, baseLine: number): FileAnalysis['inlineStyles'] {
  const out: FileAnalysis['inlineStyles'] = [];
  // Blank comments out, keeping newlines so line numbers survive.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const re = /([-\w]+)\s*:\s*([^;{}]+?)\s*(?=;|})/g;
  for (const match of text.matchAll(re)) {
    const before = text.slice(0, match.index);
    // A `prop: value` inside a selector (a:hover, ::before) is followed by `{`,
    // which the lookahead already excludes; this skips the ones at selector
    // level that are terminated by `;` only inside a block.
    if (before.lastIndexOf('{') <= before.lastIndexOf('}')) continue;
    out.push({
      prop: match[1],
      value: match[2],
      line: baseLine + (before.match(/\n/g) ?? []).length,
      origin: 'stylesheet',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function resolveRelative(fromPath: string, url: string): string {
  const parts = fromPath.split(/[\\/]/).slice(0, -1);
  for (const seg of url.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function normalize(path: string): string {
  return path.split('\\').join('/');
}

/**
 * The AnalyzedFiles for an Angular cell: every TypeScript file as itself, plus
 * one shadow JSX file per component template and one stylesheet file per
 * component style source. A template or stylesheet no changed component
 * references is not graded, the way an unreferenced file is not part of a
 * React app.
 */
export function analyzeAngularFiles(raw: RawFile[]): { files: AnalyzedFile[]; staticValues: StaticAttrValue[]; templateErrors: string[] } {
  const byPath = new Map(raw.map((f) => [normalize(f.path), f]));
  const files: AnalyzedFile[] = [];
  const staticValues: StaticAttrValue[] = [];
  const templateErrors: string[] = [];

  for (const file of raw) {
    if (!/\.(ts|js)$/.test(file.path) || file.path.endsWith('.d.ts')) continue;
    files.push({ path: file.path, source: file.source, analysis: analyzeSource(file.path, file.source) });

    for (const meta of findComponents(file.source)) {
      let template: { text: string; line: number; path: string } | undefined;
      if (meta.template) template = { ...meta.template, path: file.path };
      else if (meta.templateUrl) {
        const html = byPath.get(resolveRelative(normalize(file.path), meta.templateUrl));
        if (html) template = { text: html.source, line: 1, path: html.path };
      }
      if (template) {
        const shadow = templateToJsx(template.text, template.line, template.path);
        files.push({ path: template.path, source: shadow.source, analysis: analyzeSource(`${template.path}.tsx`, shadow.source) });
        staticValues.push(...shadow.staticValues);
        templateErrors.push(...shadow.errors.map((e) => `${template.path}: ${e}`));
      }

      const sheets: Array<{ text: string; line: number; path: string }> = meta.styles.map((s) => ({ ...s, path: file.path }));
      for (const url of meta.styleUrls) {
        const css = byPath.get(resolveRelative(normalize(file.path), url));
        if (css) sheets.push({ text: css.source, line: 1, path: css.path });
      }
      for (const sheet of sheets) {
        files.push({
          path: sheet.path,
          // No JSX, so the graders that re-parse source find nothing here.
          source: '',
          analysis: { imports: [], jsxElements: [], classNameLiterals: [], inlineStyles: stylesheetDeclarations(sheet.text, sheet.line) },
        });
      }
    }
  }

  return { files, staticValues, templateErrors };
}

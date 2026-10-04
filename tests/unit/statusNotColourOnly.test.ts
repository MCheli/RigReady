import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse } from '@vue/compiler-sfc';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../helpers';

/**
 * NFR-011, on the source: status is never conveyed by colour alone.
 *
 * How the design system does it (src/renderer/styles.css): the status colours are the
 * classes `rr-ok`, `rr-warn` and `rr-bad`. Put on text, the class also draws the status icon
 * in front of it (a different shape per status), unless the text has an icon of its own. Put
 * on a `<v-icon>`, the icon is the shape and the words must be next to it. So a feature gets
 * icon, text and colour by writing `class="rr-warn"` on words, and cannot get the colour any
 * other way without tripping one of these rules:
 *
 *  1. A status-coloured `<v-icon>` has words with it: text in the element around it (up to
 *     three levels: the icon's row), or an `aria-label` / `title` on it or its parent.
 *  2. Any other element with a status class holds words (text, an interpolation, or a
 *     component that renders them). A status-coloured empty box says nothing.
 *  3. One glyph in several status colours is colour alone: a `<v-icon>` whose class switches
 *     between status colours must switch its `:icon` too.
 *  4. `rr-no-icon` (text that carries its own sign, like the + and − of a diff) is used only
 *     by the files listed in NO_ICON, each with its reason.
 *  5. Styles do not paint text in a status colour behind the classes' back: `color:
 *     var(--rr-ok|warn|bad)` in a feature's CSS is allowed only on a selector that names the
 *     matching class, or for an entry in RAW_COLOUR with its reason. (Borders and backgrounds
 *     are decoration around something that already says it.)
 *  6. Vuetify's own status colours (`color="success|warning|error"`, `type=`) are only used on
 *     components that bring their icon or label: v-alert, v-btn, v-snackbar. The `text-*` and
 *     `bg-*` colour utility classes are not used for status at all (a destructive action in
 *     a menu or on a button may be red: its label says what it does).
 *
 * What a template cannot show (a class that comes from a variable) is checked on the rendered
 * screens by tests/e2e/a11y.ts `colourOnlyStatus`, on the Play screen and every Configure route.
 */

const TONES = ['rr-ok', 'rr-warn', 'rr-bad'] as const;
const TONE = /\brr-(ok|warn|bad)\b/;

/** Rule 4. */
const NO_ICON: Record<string, string> = {
  'features/dcs-setup/renderer/DcsExportPage.vue':
    'Lines of Export.lua that were added or removed: each starts with + or −.',
  'features/dcs-setup/renderer/DiffView.vue': 'A line diff: each line starts with its + or − sign.',
};

/** Rule 5: `file :: selector` -> why this text may take a status colour from its own style. */
const RAW_COLOUR: Record<string, string> = {
  'features/fly/renderer/FlyPage.vue :: .fly-status-ok':
    'The readiness banner: a large status icon and the words "Ready" beside it.',
  'features/fly/renderer/FlyPage.vue :: .fly-status-warn':
    'The readiness banner: a large status icon and the words "Ready with warnings".',
  'features/fly/renderer/FlyPage.vue :: .fly-status-bad':
    'The readiness banner: a large status icon and the words "Not ready".',
  'renderer/App.vue :: .shell-scenario':
    'The scenario banner of test runs: a flask icon and the word "Scenario". Not a status.',
  'features/dcs-bindings/renderer/PlanDialog.vue :: .plan-note':
    'A note in the change preview: an information icon and the sentence.',
  'features/devices/renderer/DeviceRow.vue :: .device-chip.warn':
    'The "Hidden by HidHide" chip: an eye-off icon and the words.',
  'features/stream-deck/renderer/StreamDeckSetupPage.vue :: .setup-mark-done':
    'The step marker of the setup guide: a check mark when done, the step number otherwise.',
};

interface AstNode {
  type: number;
  tag?: string;
  props?: AstProp[];
  children?: AstNode[];
  content?: string | { content: string };
}
interface AstProp {
  type: number;
  name: string;
  value?: { content: string };
  arg?: { content: string };
  exp?: { content: string };
}
const ELEMENT = 1;
const TEXT = 2;
const INTERPOLATION = 5;
const ATTRIBUTE = 6;
const DIRECTIVE = 7;

const src = path.join(repoRoot, 'src');

async function vueFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'legacy') out.push(...(await vueFiles(full)));
    } else if (/\.(vue|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const relative = (file: string): string => path.relative(src, file).replace(/\\/g, '/');

const staticAttr = (node: AstNode, name: string): string | undefined =>
  node.props?.find((p) => p.type === ATTRIBUTE && p.name === name)?.value?.content;
const boundAttr = (node: AstNode, name: string): string | undefined =>
  node.props?.find((p) => p.type === DIRECTIVE && p.name === 'bind' && p.arg?.content === name)?.exp
    ?.content;
const hasAttr = (node: AstNode, name: string): boolean =>
  staticAttr(node, name) !== undefined || boundAttr(node, name) !== undefined;
const classText = (node: AstNode): string =>
  `${staticAttr(node, 'class') ?? ''} ${boundAttr(node, 'class') ?? ''}`;
const isIcon = (node: AstNode): boolean => node.tag === 'v-icon';
/** A component other than an icon or spinner: assumed to render words. */
const isWordyComponent = (node: AstNode): boolean =>
  node.type === ELEMENT &&
  /^(v-|[A-Z]|router-link|component|slot)/.test(node.tag ?? '') &&
  !['v-icon', 'v-progress-circular', 'v-spacer', 'v-divider'].includes(node.tag ?? '');

function hasWords(node: AstNode): boolean {
  if (node.type === INTERPOLATION) return true;
  if (node.type === TEXT) {
    const text = typeof node.content === 'string' ? node.content : (node.content?.content ?? '');
    return text.trim().length > 0;
  }
  if (node.type !== ELEMENT) return (node.children ?? []).some(hasWords);
  if (isWordyComponent(node)) return true;
  if (node.props?.some((p) => p.type === DIRECTIVE && ['text', 'html'].includes(p.name)))
    return true;
  return (node.children ?? []).some(hasWords);
}

interface Finding {
  file: string;
  rule: number;
  what: string;
}

function auditTemplate(file: string, root: AstNode): Finding[] {
  const findings: Finding[] = [];
  const snippet = (node: AstNode): string =>
    `<${node.tag} class="${classText(node).trim().replace(/\s+/g, ' ').slice(0, 90)}">`;
  const walk = (node: AstNode, ancestors: AstNode[]): void => {
    if (node.type === ELEMENT) {
      const classes = classText(node);
      if (TONE.test(classes)) {
        if (isIcon(node)) {
          const named =
            hasAttr(node, 'aria-label') ||
            hasAttr(node, 'title') ||
            (ancestors[0] !== undefined &&
              (hasAttr(ancestors[0], 'aria-label') || hasAttr(ancestors[0], 'title')));
          const around = ancestors.slice(0, 3).some((a) => hasWords(a));
          if (!named && !around) {
            findings.push({ file, rule: 1, what: `icon without words: ${snippet(node)}` });
          }
          const tones = TONES.filter((tone) => (boundAttr(node, 'class') ?? '').includes(tone));
          if (tones.length > 1 && staticAttr(node, 'icon') !== undefined) {
            findings.push({
              file,
              rule: 3,
              what: `one icon (${staticAttr(node, 'icon')}) in ${tones.length} status colours: bind :icon to the status too`,
            });
          }
        } else if (!hasWords(node)) {
          findings.push({ file, rule: 2, what: `status colour on nothing: ${snippet(node)}` });
        }
      }
      if (/\brr-no-icon\b/.test(classes) && !NO_ICON[file]) {
        findings.push({ file, rule: 4, what: 'rr-no-icon outside the NO_ICON list' });
      }
      const colour = staticAttr(node, 'color') ?? '';
      const type = staticAttr(node, 'type') ?? '';
      const vuetifyStatus = /^(success|warning|error)$/;
      if (
        (vuetifyStatus.test(colour) || (node.tag?.startsWith('v-') && vuetifyStatus.test(type))) &&
        !['v-alert', 'v-btn', 'v-snackbar'].includes(node.tag ?? '')
      ) {
        findings.push({
          file,
          rule: 6,
          what: `<${node.tag}> takes a Vuetify status colour; use class="rr-ok|rr-warn|rr-bad" on the words`,
        });
      }
      // A red "Delete" in a menu is an action named by its label, like a red button.
      if (
        /\b(text|bg)-(success|warning|error)\b/.test(classes) &&
        !['v-btn', 'v-list-item'].includes(node.tag ?? '')
      ) {
        findings.push({ file, rule: 6, what: `Vuetify colour utility on ${snippet(node)}` });
      }
    }
    const next = node.type === ELEMENT ? [node, ...ancestors] : ancestors;
    for (const child of node.children ?? []) walk(child, next);
  };
  walk(root, []);
  return findings;
}

/** Rule 5: `color:` declarations that use a status token, with the selector they sit in. */
function rawColours(file: string, cssText: string): Finding[] {
  const findings: Finding[] = [];
  const withoutComments = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const block of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = block[1]!.trim().replace(/\s+/g, ' ');
    for (const declaration of block[2]!.matchAll(
      /(?:^|;)\s*color\s*:\s*var\(--rr-(ok|warn|bad)\)/g
    )) {
      const tone = `rr-${declaration[1]}`;
      const selectors = selector.split(',').map((s) => s.trim());
      for (const one of selectors) {
        if (one.includes(`.${tone}`)) continue;
        if (RAW_COLOUR[`${file} :: ${one}`]) continue;
        findings.push({
          file,
          rule: 5,
          what: `"${one}" paints text ${tone} from its own style: put class="${tone}" on the element instead (it brings the icon), or list it in RAW_COLOUR with the reason`,
        });
      }
    }
  }
  return findings;
}

describe('status is never colour alone (source audit)', () => {
  it('every status-coloured element in every template has an icon and words', async () => {
    const files = await vueFiles(src);
    expect(files.length).toBeGreaterThan(60);
    const findings: Finding[] = [];
    let toned = 0;
    for (const full of files) {
      const file = relative(full);
      const text = await fs.readFile(full, 'utf8');
      if (full.endsWith('.css')) {
        // The design system itself defines the classes.
        if (file !== 'renderer/styles.css') findings.push(...rawColours(file, text));
        continue;
      }
      const { descriptor } = parse(text, { filename: full });
      if (descriptor.template?.ast) {
        if (TONE.test(descriptor.template.content)) toned++;
        findings.push(...auditTemplate(file, descriptor.template.ast as unknown as AstNode));
      }
      for (const style of descriptor.styles) findings.push(...rawColours(file, style.content));
    }
    expect(findings.map((f) => `${f.file}: rule ${f.rule}: ${f.what}`)).toEqual([]);
    // The audit looked at something.
    expect(toned).toBeGreaterThan(30);
  });

  it('the lists of exceptions stay honest', async () => {
    for (const [file, why] of Object.entries(NO_ICON)) {
      const text = await fs.readFile(path.join(src, file), 'utf8');
      expect(text, `${file} no longer uses rr-no-icon`).toContain('rr-no-icon');
      expect(why.length).toBeGreaterThan(20);
    }
    for (const [key, why] of Object.entries(RAW_COLOUR)) {
      const [file, selector] = key.split(' :: ') as [string, string];
      const text = await fs.readFile(path.join(src, file), 'utf8');
      expect(text, `${key} is gone`).toContain(selector.split(' ')[0]!);
      expect(why.length).toBeGreaterThan(20);
    }
  });

  it('the rules catch what they are for', () => {
    const audit = (template: string, style = ''): number[] => {
      const { descriptor } = parse(`<template>${template}</template><style>${style}</style>`, {
        filename: 'Sample.vue',
      });
      return [
        ...auditTemplate('Sample.vue', descriptor.template!.ast as unknown as AstNode),
        ...descriptor.styles.flatMap((s) => rawColours('Sample.vue', s.content)),
      ].map((f) => f.rule);
    };
    // Fine: words in a status class, an icon with words beside it, an icon with a name.
    expect(audit('<span class="rr-ok">Connected</span>')).toEqual([]);
    expect(audit('<div><v-icon icon="mdi-alert" class="rr-warn" /> {{ message }}</div>')).toEqual(
      []
    );
    expect(audit('<v-icon icon="mdi-alert" class="rr-warn" aria-label="Warning" />')).toEqual([]);
    expect(
      audit(
        '<div class="rr-row"><v-icon :icon="i" :class="t ? \'rr-ok\' : \'rr-bad\'" /><b>x</b></div>'
      )
    ).toEqual([]);
    // Caught.
    expect(audit('<div><v-icon icon="mdi-circle" class="rr-bad" /></div>')).toEqual([1]);
    expect(audit('<span class="dot rr-ok"></span>')).toEqual([2]);
    expect(
      audit('<p><v-icon icon="mdi-usb" :class="over ? \'rr-bad\' : \'rr-ok\'" /> USB</p>')
    ).toEqual([3]);
    expect(audit('<span class="rr-bad rr-no-icon">x</span>')).toEqual([4]);
    expect(audit('<b class="state">On</b>', '.state { color: var(--rr-ok); }')).toEqual([5]);
    expect(audit('<b class="rr-ok state">On</b>', '.state.rr-ok { color: var(--rr-ok); }')).toEqual(
      []
    );
    expect(audit('<v-chip color="success">On</v-chip>')).toEqual([6]);
    expect(audit('<span class="text-error">Off</span>')).toEqual([6]);
    expect(audit('<v-btn color="error">Delete</v-btn>')).toEqual([]);
  });
});

import { computed, defineComponent, h, type VNode } from 'vue';
import { parseMarkdown, plainText, type Block, type Inline } from '../core/markdown';

/**
 * A reply's Markdown as Vue nodes. Every node is built here with h() from the parsed tree and
 * every piece of the reply ends up as a text child: nothing the model wrote is ever handed to
 * the page as HTML, so there is no `v-html` and no `innerHTML` anywhere in this view.
 *
 * Links: the parser lets through http and https addresses only. An https link opens in the
 * system browser, the way the manual's links do (the main process hands it to Windows and
 * opens no window); the app's window never navigates. An http link is shown as text with its
 * address, because RigReady opens https addresses only.
 */

type Child = VNode | string;

/** Opens an address in the system browser. RigReady's window itself never goes there. */
export function openLink(href: string): void {
  if (!href.startsWith('https://')) return;
  window.open(href, '_blank', 'noopener');
}

function link(node: Extract<Inline, { kind: 'link' }>): Child[] {
  const label = renderInline(node.children);
  const written = plainText(node.children);
  if (!node.href.startsWith('https://')) {
    // Shown, not opened: the address is there to read and copy.
    return written === node.href || written === '' ? [node.href] : [...label, ` (${node.href})`];
  }
  return [
    h(
      'a',
      {
        class: 'md-link',
        href: node.href,
        title: node.href,
        target: '_blank',
        rel: 'noopener noreferrer',
        onClick: (event: Event) => {
          event.preventDefault();
          openLink(node.href);
        },
      },
      label.length > 0 ? label : [node.href]
    ),
  ];
}

export function renderInline(nodes: Inline[]): Child[] {
  const out: Child[] = [];
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        out.push(node.text);
        break;
      case 'strong':
        out.push(h('strong', renderInline(node.children)));
        break;
      case 'em':
        out.push(h('em', renderInline(node.children)));
        break;
      case 'code':
        out.push(h('code', { class: 'md-code' }, node.text));
        break;
      case 'link':
        out.push(...link(node));
        break;
      case 'break':
        out.push(h('br'));
        break;
    }
  }
  return out;
}

export function renderBlocks(blocks: Block[]): VNode[] {
  return blocks.map((block): VNode => {
    switch (block.kind) {
      case 'paragraph':
        return h('p', renderInline(block.children));
      case 'heading':
        // A heading inside a message, below the panel's own: never a page heading.
        return h(
          'div',
          {
            class: ['md-heading', `md-heading-${Math.min(block.level, 3)}`],
            role: 'heading',
            'aria-level': Math.min(block.level + 2, 6),
          },
          renderInline(block.children)
        );
      case 'code':
        return h(
          'pre',
          {
            class: 'md-pre',
            tabindex: 0,
            ...(block.language ? { 'data-language': block.language } : {}),
          },
          [h('code', block.text)]
        );
      case 'list':
        return h(
          block.ordered ? 'ol' : 'ul',
          block.ordered && block.start !== 1 ? { start: block.start } : null,
          block.items.map((item) => h('li', renderBlocks(item)))
        );
      case 'quote':
        return h('blockquote', renderBlocks(block.children));
      case 'rule':
        return h('hr');
    }
  });
}

/** A reply, formatted. Parsed once for a text: the panel shows many and redraws often. */
export const MarkdownText = defineComponent({
  name: 'MarkdownText',
  props: { source: { type: String, required: true } },
  setup(props) {
    const blocks = computed(() => parseMarkdown(props.source));
    return () => h('div', { class: 'md' }, renderBlocks(blocks.value));
  },
});

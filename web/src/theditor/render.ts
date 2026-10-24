// Draw a node's formatted content: the editor's own schema serializes the (validated) document to
// DOM nodes, never through an HTML string, and a sanitizing pass runs over the result anyway.
import { getSchema } from '@tiptap/core';
import { DOMSerializer, Node as PMNode, type Schema } from '@tiptap/pm/model';
import { formattedExtensions } from './vendor/extensions';
import { isFormattedHref, isFormattedImageSrc, parseFormattedDoc, type FormattedDoc } from './vendor/formatted-message';

let schema: Schema | null = null;
let serializer: DOMSerializer | null = null;

/** The editor's schema, built once. */
export function formattedSchema(): Schema {
  if (!schema) schema = getSchema(formattedExtensions());
  return schema;
}

const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'srcset', 'poster', 'background']);

/** Defence in depth: no handlers, no scripts, only web links and image sources the model allows. */
function sanitize(root: DocumentFragment, links: boolean) {
  for (const el of [...root.querySelectorAll('*')]) {
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'svg', 'math'].includes(tag)) {
      el.remove();
      continue;
    }
    for (const { name, value } of [...el.attributes]) {
      const n = name.toLowerCase();
      if (n.startsWith('on') || n === 'contenteditable') el.removeAttribute(name);
      else if (URL_ATTRS.has(n) && !(n === 'href' && tag === 'a' && isFormattedHref(value)) && !(n === 'src' && tag === 'img' && isFormattedImageSrc(value))) el.removeAttribute(name);
    }
    if (tag === 'a') {
      if (links && el.hasAttribute('href')) {
        el.className = 'node-link';
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
        el.setAttribute('title', 'Open link in a new tab');
        el.setAttribute('draggable', 'false');
      } else {
        // A node that is itself a button (or a link the model refused) shows the words only.
        const span = document.createElement('span');
        span.append(...el.childNodes);
        el.replaceWith(span);
      }
    } else if (tag === 'input') {
      (el as HTMLInputElement).disabled = true;
      el.setAttribute('tabindex', '-1');
    } else if (tag === 'img') {
      el.setAttribute('draggable', 'false');
    }
  }
}

/** Draw `content` into `target`. False when the model refuses it (the node then shows its words). */
export function renderFormatted(target: HTMLElement, content: FormattedDoc, links: boolean): boolean {
  const doc = parseFormattedDoc(content);
  let fragment: DocumentFragment | null = null;
  if (doc) {
    try {
      const s = formattedSchema();
      serializer ??= DOMSerializer.fromSchema(s);
      fragment = serializer.serializeFragment(PMNode.fromJSON(s, doc).content, { document: target.ownerDocument }) as DocumentFragment;
    } catch {
      fragment = null;
    }
  }
  if (!fragment) return false;
  sanitize(fragment, links);
  target.replaceChildren(fragment);
  return true;
}

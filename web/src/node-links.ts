/** Link only explicit web URLs, preserving the original text and its surrounding punctuation. */
export type NodeTextPart = { text: string; href?: string };

export function nodeTextParts(text: string): NodeTextPart[] {
  const parts: NodeTextPart[] = [];
  let at = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`\u0000-\u001f\u007f]+/gi)) {
    let url = match[0];
    // Sentence punctuation is not part of a pasted link; balanced URL parentheses are.
    for (;;) {
      const last = url[url.length - 1];
      const close = ({ ')': '(', ']': '[', '}': '{' } as Record<string, string>)[last];
      if (/[.,;:!?]/.test(last) || (close && url.split(last).length > url.split(close).length)) url = url.slice(0, -1);
      else break;
    }
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) continue;
    } catch { continue; }
    const start = match.index!;
    if (start > at) parts.push({ text: text.slice(at, start) });
    parts.push({ text: url, href: url });
    at = start + url.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}

/** DOM construction, not HTML interpolation: text and URL attributes never become markup. */
export function renderNodeText(element: HTMLElement, text: string, links: boolean) {
  if (element.textContent === text && element.dataset.links === String(links)) return;
  element.dataset.links = String(links);
  if (!links) { element.textContent = text; return; }
  element.replaceChildren(...nodeTextParts(text).map((part) => {
    if (!part.href) return document.createTextNode(part.text);
    const link = document.createElement('a');
    link.className = 'node-link';
    link.href = part.href;
    link.textContent = part.text;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.title = 'Open link in a new tab';
    link.draggable = false;
    return link;
  }));
}

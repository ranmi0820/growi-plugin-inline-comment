export type Placeholder = {
  placeholderIndex: number;
  mountEl: HTMLElement;
};

const MARKER = '@comment';

export function findAndMountPlaceholders(): Placeholder[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    if (t.nodeValue && t.nodeValue.includes(MARKER)) {
      textNodes.push(t);
    }
  }

  const placeholders: Placeholder[] = [];
  let idx = 0;

  for (const textNode of textNodes) {
    let text = textNode.nodeValue ?? '';

    while (text.includes(MARKER)) {
      const mount = document.createElement('span');
      mount.className = 'inline-comment-mount';
      mount.style.display = 'block';
      mount.style.margin = '10px 0';

      // @comment を1個だけ消す
      text = text.replace(MARKER, '');
      textNode.nodeValue = text;

      textNode.parentNode?.insertBefore(mount, textNode);

      placeholders.push({
        placeholderIndex: idx++,
        mountEl: mount,
      });
    }
  }

  return placeholders;
}


export type Placeholder = {
  placeholderIndex: number;
  mountEl: HTMLElement;
};

export function findAndMountPlaceholders(): Placeholder[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    const t = walker.currentNode as Text;
    if (t.nodeValue && t.nodeValue.includes('$comment')) textNodes.push(t);
  }

  const placeholders: Placeholder[] = [];
  let idx = 0;

  for (const textNode of textNodes) {
    let text = textNode.nodeValue ?? '';
    // テキストノード内に複数 $comment がある可能性もあるのでループ
    while (text.includes('$comment')) {
      // 1つ分だけ除去して、その場所にmountを挿入
      const mount = document.createElement('span');
      mount.className = 'inline-comment-mount';
      mount.style.display = 'block';
      mount.style.margin = '10px 0';

      // 先頭の $comment を消す
      text = text.replace('$comment', '');
      textNode.nodeValue = text;

      // $comment が含まれていたテキストの直前に挿入（見た目が自然）
      textNode.parentNode?.insertBefore(mount, textNode);

      placeholders.push({ placeholderIndex: idx++, mountEl: mount });
    }
  }

  return placeholders;
}


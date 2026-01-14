export type Placeholder = {
  placeholderIndex: number;
  mountEl: HTMLElement;
};

const COMMENT_MARKER_PREFIX = 'inline-comment:';

// すでにフォームを挿している場合の二重挿入防止
function alreadyMountedNear(node: Comment): boolean {
  const prev = node.previousSibling as HTMLElement | null;
  return !!(prev && prev.nodeType === 1 && (prev as HTMLElement).classList.contains('inline-comment-mount'));
}

export function findAndMountPlaceholders(): Placeholder[] {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_COMMENT, // ★ここが重要（HTMLコメントを拾う）
  );

  const placeholders: Placeholder[] = [];
  let idx = 0;

  while (walker.nextNode()) {
    const c = walker.currentNode as Comment;
    const v = (c.nodeValue ?? '').trim(); // 例: " inline-comment:abcd... "

    if (!v.startsWith(COMMENT_MARKER_PREFIX)) continue;
    if (alreadyMountedNear(c)) continue;

    const mount = document.createElement('span');
    mount.className = 'inline-comment-mount';
    mount.style.display = 'block';
    mount.style.margin = '10px 0';

    // ★コメントノードは消さない。直前に mount を差し込むだけ
    c.parentNode?.insertBefore(mount, c);

    placeholders.push({ placeholderIndex: idx++, mountEl: mount });
  }

  return placeholders;
}


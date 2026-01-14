export type Placeholder = {
  placeholderIndex: number;
  mountEl: HTMLElement;
};

const TEXT_MARKER = '@comment';
const COMMENT_MARKER_PREFIX = 'inline-comment:';

// 二重挿入防止（直前に mount があるならスキップ）
function alreadyMountedNear(node: Node): boolean {
  const prev = node.previousSibling as HTMLElement | null;
  return !!(
    prev &&
    prev.nodeType === 1 &&
    (prev as HTMLElement).classList.contains('inline-comment-mount')
  );
}

function createMountEl(): HTMLElement {
  const mount = document.createElement('span');
  mount.className = 'inline-comment-mount';
  mount.style.display = 'block';
  mount.style.margin = '10px 0';
  return mount;
}

/**
 * 1) テキスト中の "@comment" をDOMで置換して（見えない）アンカーspanにする
 * 2) data-inline-comment / HTMLコメント も拾って、順番通りに mount を差し込む
 */
export function findAndMountPlaceholders(): Placeholder[] {
  const placeholders: Placeholder[] = [];
  let idx = 0;

  // --------------------------
  // A) まず "@comment"（テキスト）をアンカーspanに変換
  // --------------------------
  const textWalker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const t = node.nodeValue ?? '';
        if (!t.includes(TEXT_MARKER)) return NodeFilter.FILTER_REJECT;
        // すでに mount の中なら無視
        if ((node.parentElement?.closest('.inline-comment-mount')) != null) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  const textNodes: Text[] = [];
  while (textWalker.nextNode()) {
    textNodes.push(textWalker.currentNode as Text);
  }

  for (const tn of textNodes) {
    let cur: Text | null = tn;
    while (cur) {
      const s = cur.nodeValue ?? '';
      const pos = s.indexOf(TEXT_MARKER);
      if (pos === -1) break;

      const before = s.slice(0, pos);
      const after = s.slice(pos + TEXT_MARKER.length);

      const parent = cur.parentNode;
      if (!parent) break;

      if (before.length > 0) {
        parent.insertBefore(document.createTextNode(before), cur);
      }

      // "@comment" を見えないアンカーspanに置換（表示から消す）
      const anchor = document.createElement('span');
      anchor.setAttribute('data-inline-comment-anchor', '1');
      anchor.style.display = 'none';
      parent.insertBefore(anchor, cur);

      // 残りテキストを差し替え
      if (after.length > 0) {
        const newText = document.createTextNode(after);
        parent.insertBefore(newText, cur);
        parent.removeChild(cur);
        cur = newText;
      } else {
        parent.removeChild(cur);
        cur = null;
      }
    }
  }

  // --------------------------
  // B) アンカー候補を「DOM順」に集める
  //    - <span data-inline-comment="..."></span>
  //    - <span data-inline-comment-anchor="1"></span>（Aで作ったやつ）
  // --------------------------
  const spanAnchors = Array.from(
    document.querySelectorAll('span[data-inline-comment], span[data-inline-comment-anchor]')
  );

  // --------------------------
  // C) HTMLコメント <!-- inline-comment:... --> も拾う（保険）
  // --------------------------
  const commentWalker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_COMMENT,
    null
  );

  const commentNodes: Comment[] = [];
  while (commentWalker.nextNode()) {
    const c = commentWalker.currentNode as Comment;
    if ((c.nodeValue ?? '').includes(COMMENT_MARKER_PREFIX)) {
      commentNodes.push(c);
    }
  }

  // spanアンカーとcommentノードをまとめて、DOM順に処理する
  const allAnchors: Node[] = [...spanAnchors, ...commentNodes].sort((a, b) => {
    if (a === b) return 0;
    const pos = a.compareDocumentPosition(b);
    // a が b より前なら -1
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    return 1;
  });

  for (const node of allAnchors) {
    if (alreadyMountedNear(node)) continue;

    const mount = createMountEl();
    node.parentNode?.insertBefore(mount, node);

    placeholders.push({
      placeholderIndex: idx++,
      mountEl: mount,
    });
  }

  return placeholders;
}


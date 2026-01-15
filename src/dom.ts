export type Placeholder = {
  placeholderIndex: number;
  mountEl: HTMLElement;
};

const COMMENT_TEXT_MARKER = '@comment';
const ARTICLE_TEXT_MARKER = '@article';
const COMMENT_MARKER_PREFIX = 'inline-comment:'; // 保険：HTMLコメント形式

function createCommentMountEl(): HTMLElement {
  const mount = document.createElement('span');
  mount.className = 'inline-comment-mount';
  mount.style.display = 'block';
  mount.style.margin = '10px 0';
  return mount;
}

function alreadyMountedNear(node: Node, className: string): boolean {
  const prev = node.previousSibling as HTMLElement | null;
  return !!(prev && prev.nodeType === 1 && prev.classList.contains(className));
}

/**
 * 指定マーカー(@comment/@article)を含むTextノードを分割し、
 * マーカー部分を「見えないアンカー要素」に置換する。
 *
 * - 例: "aaa @comment bbb" → "aaa " + <span data-... style="display:none"> + " bbb"
 */
function replaceTextMarkerWithHiddenAnchors(
  marker: string,
  anchorAttrName: string
): HTMLElement[] {
  const anchors: HTMLElement[] = [];

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const t = node.nodeValue ?? '';
        if (!t.includes(marker)) return NodeFilter.FILTER_REJECT;

        // すでにマウント済み領域の中は触らない
        const pe = node.parentElement;
        if (pe?.closest('.inline-comment-mount') || pe?.closest('.inline-article-mount')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  for (const tn of textNodes) {
    let cur: Text | null = tn;

    while (cur) {
      const s = cur.nodeValue ?? '';
      const pos = s.indexOf(marker);
      if (pos === -1) break;

      const before = s.slice(0, pos);
      const after = s.slice(pos + marker.length);

      const parent = cur.parentNode;
      if (!parent) break;

      if (before.length > 0) {
        parent.insertBefore(document.createTextNode(before), cur);
      }

      const anchor = document.createElement('span');
      anchor.setAttribute(anchorAttrName, '1');
      anchor.style.display = 'none';
      parent.insertBefore(anchor, cur);
      anchors.push(anchor);

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

  return anchors;
}

/**
 * @article の位置に記事投稿フォームを表示するための mount を返す
 */
export function findArticleMounts(): HTMLElement[] {
  // まず @article の文字を見えないアンカーへ
  const anchors = replaceTextMarkerWithHiddenAnchors(ARTICLE_TEXT_MARKER, 'data-inline-article-anchor');

  // その直前に mount を差し込む（同じ場所に何回も入れない）
  const mounts: HTMLElement[] = [];

  for (const a of anchors) {
    if (alreadyMountedNear(a, 'inline-article-mount')) continue;

    const mount = document.createElement('div');
    mount.className = 'inline-article-mount';
    mount.style.margin = '12px 0';
    a.parentNode?.insertBefore(mount, a);
    mounts.push(mount);
  }

  return mounts;
}

/**
 * @comment の位置にコメントフォームを表示するための mount を差し込み、
 * placeholderIndex 順に返す
 */
export function findAndMountPlaceholders(): Placeholder[] {
  const placeholders: Placeholder[] = [];
  let idx = 0;

  // A) まず @comment の文字を見えないアンカーへ
  const commentTextAnchors = replaceTextMarkerWithHiddenAnchors(
    COMMENT_TEXT_MARKER,
    'data-inline-comment-anchor'
  );

  // B) リレー側が置換した span(data-inline-comment="...") も拾う
  const spanAnchors = Array.from(
    document.querySelectorAll('span[data-inline-comment], span[data-inline-comment-anchor]')
  );

  // C) さらに保険で HTMLコメント <!-- inline-comment:... --> を拾う
  const commentWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT, null);
  const htmlCommentAnchors: Comment[] = [];
  while (commentWalker.nextNode()) {
    const c = commentWalker.currentNode as Comment;
    if ((c.nodeValue ?? '').includes(COMMENT_MARKER_PREFIX)) {
      htmlCommentAnchors.push(c);
    }
  }

  // D) 全アンカーをDOM順でまとめる（Text由来のanchorも spanAnchors に含まれるが、重複してもOK）
  const allAnchors: Node[] = [...spanAnchors, ...htmlCommentAnchors].sort((a, b) => {
    if (a === b) return 0;
    const pos = a.compareDocumentPosition(b);
    // a が b より前なら -1
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    return 1;
  });

  // E) DOM順に mount を差し込み、placeholderIndex を付与
  for (const node of allAnchors) {
    if (alreadyMountedNear(node, 'inline-comment-mount')) continue;

    const mount = createCommentMountEl();
    node.parentNode?.insertBefore(mount, node);

    placeholders.push({
      placeholderIndex: idx++,
      mountEl: mount,
    });
  }

  // ※ commentTextAnchors は既に spanAnchors に含まれているが、
  //   ここで未使用でも問題ありません（置換自体が目的）。
  void commentTextAnchors;

  return placeholders;
}


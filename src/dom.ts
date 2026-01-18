export type Placeholder = {
  placeholderIndex: number;
  mountEl: HTMLElement;
};

const COMMENT_TEXT_MARKER = '@comment';
const ARTICLE_TEXT_MARKER = '@article';
const COMMENT_MARKER_PREFIX = 'inline-comment:'; // 保険：HTMLコメント形式

// この記事（スクショ）で本文はここに確定
const VIEW_ROOT_SELECTOR = '#page-view-content-container .wiki';

// アンカー（不可視）に付ける属性名
const COMMENT_ANCHOR_ATTR = 'data-inline-comment-anchor';
const ARTICLE_ANCHOR_ATTR = 'data-inline-article-anchor';

// アンカーに「mount 済み」を刻む属性（冪等化）
const COMMENT_MOUNTED_ATTR = 'data-inline-comment-mounted';
const ARTICLE_MOUNTED_ATTR = 'data-inline-article-mounted';

// HTMLコメント用ガード
const HTML_ANCHOR_ATTR = 'data-inline-comment-html-anchor';

export function getViewRoot(): HTMLElement | null {
  return document.querySelector(VIEW_ROOT_SELECTOR);
}

function isInNoTouchArea(el: Element | null): boolean {
  if (!el) return false;
  // Markdown の code/pre 内は触らない
  return !!el.closest('pre, code, kbd, samp');
}

function createCommentMountEl(): HTMLElement {
  const mount = document.createElement('span');
  mount.className = 'inline-comment-mount';
  mount.style.display = 'block';
  mount.style.margin = '10px 0';
  return mount;
}

function createArticleMountEl(): HTMLElement {
  const mount = document.createElement('div');
  mount.className = 'inline-article-mount';
  mount.style.margin = '12px 0';
  return mount;
}

function safeRemoveChild(parent: Node, child: Node) {
  try {
    const anyParent = parent as any;
    if (typeof anyParent.contains === 'function' && !anyParent.contains(child)) return;
    parent.removeChild(child);
  } catch {
    // noop
  }
}

function sortDomOrder(nodes: Node[]): Node[] {
  return nodes.sort((a, b) => {
    if (a === b) return 0;
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    return 1;
  });
}

/**
 * 指定マーカー(@comment/@article)を含むTextノードを分割し、
 * マーカー部分を「見えないアンカー要素」に置換する。
 *
 * ★重要:
 * - 触るのは「ビュー本文の .wiki だけ」
 * - mount 内や code/pre 内は触らない
 * - 何度走っても壊れない（冪等）
 */
function replaceTextMarkerWithHiddenAnchors(
  root: HTMLElement,
  marker: string,
  anchorAttrName: string
): HTMLElement[] {
  const anchors: HTMLElement[] = [];

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        const t = node.nodeValue ?? '';
        if (!t.includes(marker)) return NodeFilter.FILTER_REJECT;

        const pe = (node as Text).parentElement;
        if (!pe) return NodeFilter.FILTER_REJECT;

        // mount 自体の中は触らない
        if (pe.closest('.inline-comment-mount') || pe.closest('.inline-article-mount')) {
          return NodeFilter.FILTER_REJECT;
        }

        // code/pre 内は触らない
        if (isInNoTouchArea(pe)) return NodeFilter.FILTER_REJECT;

        return NodeFilter.FILTER_ACCEPT;
      },
    } as any
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

      const parent = cur.parentNode;
      if (!parent) break;

      const anyParent = parent as any;
      if (typeof anyParent.contains === 'function' && !anyParent.contains(cur)) break;

      const before = s.slice(0, pos);
      const after = s.slice(pos + marker.length);

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
        safeRemoveChild(parent, cur);
        cur = newText;
      } else {
        safeRemoveChild(parent, cur);
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
  const root = getViewRoot();
  if (!root) return [];

  // まず @article の文字をアンカーへ（存在するなら）
  replaceTextMarkerWithHiddenAnchors(root, ARTICLE_TEXT_MARKER, ARTICLE_ANCHOR_ATTR);

  // アンカー収集（本文内のみ）
  const anchors = Array.from(root.querySelectorAll<HTMLElement>(`span[${ARTICLE_ANCHOR_ATTR}]`));

  const mounts: HTMLElement[] = [];
  for (const a of anchors) {
    if (a.getAttribute(ARTICLE_MOUNTED_ATTR) === '1') continue;

    const parent = a.parentNode;
    if (!parent) continue;

    const mount = createArticleMountEl();
    parent.insertBefore(mount, a);

    a.setAttribute(ARTICLE_MOUNTED_ATTR, '1');
    mounts.push(mount);
  }

  return mounts;
}

/**
 * @comment の位置にコメントフォームを表示するための mount を差し込み、
 * placeholderIndex 順に返す
 */
export function findAndMountPlaceholders(): Placeholder[] {
  const root = getViewRoot();
  if (!root) return [];

  const placeholders: Placeholder[] = [];
  let idx = 0;

  // A) @comment の文字をアンカーへ（存在するなら）
  replaceTextMarkerWithHiddenAnchors(root, COMMENT_TEXT_MARKER, COMMENT_ANCHOR_ATTR);

  // B) リレー側が置換した span(data-inline-comment="...") も拾う + テキスト置換アンカー
  const spanAnchors = Array.from(
    root.querySelectorAll<HTMLElement>(`span[data-inline-comment], span[${COMMENT_ANCHOR_ATTR}]`)
  );

  // C) HTMLコメント <!-- inline-comment:... --> も拾う（本文内のみ）
  const commentWalker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT, null);
  const htmlCommentAnchors: Comment[] = [];
  while (commentWalker.nextNode()) {
    const c = commentWalker.currentNode as Comment;
    if ((c.nodeValue ?? '').includes(COMMENT_MARKER_PREFIX)) {
      htmlCommentAnchors.push(c);
    }
  }

  // D) DOM順にまとめる
  const allAnchors: Node[] = sortDomOrder([...spanAnchors, ...htmlCommentAnchors]);

  // E) mount を差し込む（冪等：アンカーに mounted フラグ）
  for (const node of allAnchors) {
    // span アンカー
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;

      if (el.closest('.inline-comment-mount') || el.closest('.inline-article-mount')) continue;
      if (isInNoTouchArea(el)) continue;

      if (el.getAttribute(COMMENT_MOUNTED_ATTR) === '1') continue;

      const parent = el.parentNode;
      if (!parent) continue;

      const mount = createCommentMountEl();
      parent.insertBefore(mount, el);

      el.setAttribute(COMMENT_MOUNTED_ATTR, '1');

      placeholders.push({ placeholderIndex: idx++, mountEl: mount });
      continue;
    }

    // HTMLコメント（Commentノード）
    if (node.nodeType === Node.COMMENT_NODE) {
      const c = node as Comment;
      const parent = c.parentNode;
      if (!parent) continue;

      const prev = c.previousSibling;
      if (prev && prev.nodeType === Node.ELEMENT_NODE) {
        const prevEl = prev as HTMLElement;
        if (prevEl.getAttribute(HTML_ANCHOR_ATTR) === '1') {
          if (prevEl.getAttribute(COMMENT_MOUNTED_ATTR) === '1') continue;

          const mount = createCommentMountEl();
          parent.insertBefore(mount, c);

          prevEl.setAttribute(COMMENT_MOUNTED_ATTR, '1');
          placeholders.push({ placeholderIndex: idx++, mountEl: mount });
          continue;
        }
      }

      const guard = document.createElement('span');
      guard.setAttribute(HTML_ANCHOR_ATTR, '1');
      guard.style.display = 'none';
      parent.insertBefore(guard, c);

      const mount = createCommentMountEl();
      parent.insertBefore(mount, c);

      guard.setAttribute(COMMENT_MOUNTED_ATTR, '1');
      placeholders.push({ placeholderIndex: idx++, mountEl: mount });
      continue;
    }
  }

  return placeholders;
}


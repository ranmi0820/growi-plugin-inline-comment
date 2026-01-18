export type Placeholder = {
  placeholderIndex: number;
  mountEl: HTMLElement;
};

const COMMENT_TEXT_MARKER = '@comment';
const ARTICLE_TEXT_MARKER = '@article';
const COMMENT_MARKER_PREFIX = 'inline-comment:'; // 保険：HTMLコメント形式

// 本文はここで確定（あなたのスクショより）
const VIEW_ROOT_SELECTOR = '#page-view-content-container .wiki';

// ターゲット行に付けるフラグ（冪等化）
const COMMENT_MOUNTED_ATTR = 'data-inline-comment-mounted';
const ARTICLE_MOUNTED_ATTR = 'data-inline-article-mounted';

// HTMLコメント用ガード
const HTML_ANCHOR_ATTR = 'data-inline-comment-html-anchor';

function getViewRoot(): HTMLElement | null {
  return document.querySelector(VIEW_ROOT_SELECTOR);
}

function isInNoTouchArea(el: Element | null): boolean {
  if (!el) return false;
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

function sortDomOrder(nodes: Node[]): Node[] {
  return nodes.sort((a, b) => {
    if (a === b) return 0;
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    return 1;
  });
}

/**
 * marker を含む「行（要素）」を拾う。
 * - 文字列自体は消さない（表示として残す）
 * - <p>@comment</p> のような単独行を優先
 */
function findMarkerElements(root: HTMLElement, marker: string): HTMLElement[] {
  // よく本文を構成する要素を中心に探す（重くしない）
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('p, li, blockquote, div, span'));

  const hits: HTMLElement[] = [];
  for (const el of candidates) {
    if (el.closest('.inline-comment-mount') || el.closest('.inline-article-mount')) continue;
    if (isInNoTouchArea(el)) continue;

    const text = (el.textContent || '').trim();
    if (!text.includes(marker)) continue;

    // 「行として marker だけ」(または前後空白のみ) を優先的に扱いやすい
    // ただし混在でも一応対応：含んでいれば対象にする
    hits.push(el);
  }
  return hits;
}

/**
 * @article の位置に記事投稿フォームを表示するための mount を返す
 * 文字列 @article は消さない。@article を含む要素の「直前」に mount を挿入する。
 */
export function findArticleMounts(): HTMLElement[] {
  const root = getViewRoot();
  if (!root) return [];

  const targets = findMarkerElements(root, ARTICLE_TEXT_MARKER);
  const mounts: HTMLElement[] = [];

  for (const t of targets) {
    if (t.getAttribute(ARTICLE_MOUNTED_ATTR) === '1') continue;

    const parent = t.parentNode;
    if (!parent) continue;

    const mount = createArticleMountEl();
    parent.insertBefore(mount, t);

    t.setAttribute(ARTICLE_MOUNTED_ATTR, '1');
    mounts.push(mount);
  }

  return mounts;
}

/**
 * @comment の位置にコメントフォームを表示するための mount を差し込み、
 * placeholderIndex 順に返す
 *
 * 文字列 @comment は消さない。@comment を含む要素の「直前」に mount を挿入する。
 *
 * さらに、サーバが置換した <span data-inline-comment="..."></span> も拾う（これは文字列ではないため）。
 */
export function findAndMountPlaceholders(): Placeholder[] {
  const root = getViewRoot();
  if (!root) return [];

  const placeholders: Placeholder[] = [];
  let idx = 0;

  // 1) 「文字列 @comment」を含む要素（行）を拾う
  const textTargets = findMarkerElements(root, COMMENT_TEXT_MARKER);

  // 2) サーバ置換の span(data-inline-comment) も拾う
  const spanAnchors = Array.from(root.querySelectorAll<HTMLElement>('span[data-inline-comment]'));

  // 3) HTMLコメント <!-- inline-comment:... --> も拾う（保険）
  const commentWalker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT, null);
  const htmlCommentAnchors: Comment[] = [];
  while (commentWalker.nextNode()) {
    const c = commentWalker.currentNode as Comment;
    if ((c.nodeValue ?? '').includes(COMMENT_MARKER_PREFIX)) {
      htmlCommentAnchors.push(c);
    }
  }

  // 4) DOM順でまとめる
  const nodes: Node[] = sortDomOrder([
    ...textTargets,
    ...spanAnchors,
    ...htmlCommentAnchors,
  ]);

  for (const node of nodes) {
    // A) 文字列ターゲット（HTMLElement）
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;

      // サーバ span と文字列行は区別したい：
      // - 文字列行は el.textContent に @comment があるはず
      // - サーバ span は textContent 空のことが多い
      const isTextLine = ((el.textContent || '').trim().includes(COMMENT_TEXT_MARKER));

      if (isTextLine) {
        if (el.getAttribute(COMMENT_MOUNTED_ATTR) === '1') continue;

        const parent = el.parentNode;
        if (!parent) continue;

        const mount = createCommentMountEl();
        parent.insertBefore(mount, el);

        el.setAttribute(COMMENT_MOUNTED_ATTR, '1');

        placeholders.push({ placeholderIndex: idx++, mountEl: mount });
        continue;
      }

      // B) サーバ span(data-inline-comment)
      if (el.matches('span[data-inline-comment]')) {
        if (el.getAttribute(COMMENT_MOUNTED_ATTR) === '1') continue;

        const parent = el.parentNode;
        if (!parent) continue;

        const mount = createCommentMountEl();
        parent.insertBefore(mount, el);

        el.setAttribute(COMMENT_MOUNTED_ATTR, '1');

        placeholders.push({ placeholderIndex: idx++, mountEl: mount });
        continue;
      }

      continue;
    }

    // C) HTMLコメント（Commentノード）
    if (node.nodeType === Node.COMMENT_NODE) {
      const c = node as Comment;
      const parent = c.parentNode;
      if (!parent) continue;

      // 直前にガードspanがあるならそれを使う
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

      // 新規ガードspanを挿入
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


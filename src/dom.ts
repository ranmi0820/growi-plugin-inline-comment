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

// ビューで marker 行を隠したか（冪等化）
const MARKER_HIDDEN_ATTR = 'data-inline-marker-hidden';

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
 * ビューでのみ、marker の「単独行」を非表示にする。
 * - 例: <p>@comment</p> / <li>@article</li>
 * - 文中に混ざるケースを誤爆しないように完全一致のみ
 */
function hideMarkerLineIfExact(el: HTMLElement, marker: string): void {
  if (!el) return;
  if (el.getAttribute(MARKER_HIDDEN_ATTR) === '1') return;

  const text = (el.textContent || '').trim();
  if (text !== marker) return;

  el.setAttribute(MARKER_HIDDEN_ATTR, '1');
  el.style.setProperty('display', 'none', 'important');
}

/**
 * marker を含む「行（要素）」を拾う。
 * - div / span は拾わない（他DOMとの競合を避ける）
 * - 行になりやすい要素だけに限定
 */
function findMarkerElements(root: HTMLElement, marker: string): HTMLElement[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('p, li, blockquote'));

  const hits: HTMLElement[] = [];
  for (const el of candidates) {
    if (el.closest('.inline-comment-mount') || el.closest('.inline-article-mount')) continue;
    if (isInNoTouchArea(el)) continue;

    const text = (el.textContent || '').trim();
    if (!text.includes(marker)) continue;

    hits.push(el);
  }
  return hits;
}

/**
 * @article の位置に記事投稿フォームを表示するための mount を返す
 * - mount は @article を含む要素の「直前」に挿入
 * - ★ビューでは @article 単独行だけ非表示にする（編集テキストは無関係）
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

    // ★追加：ビューでは @article 単独行を消す（完全一致のみ）
    hideMarkerLineIfExact(t, ARTICLE_TEXT_MARKER);

    t.setAttribute(ARTICLE_MOUNTED_ATTR, '1');
    mounts.push(mount);
  }

  return mounts;
}

/**
 * @comment の位置にコメントフォームを表示するための mount を差し込み、
 * placeholderIndex 順に返す
 *
 * - mount は @comment を含む要素の「直前」に挿入
 * - さらに、サーバが置換した <span data-inline-comment="..."></span> も拾う
 * - ★ビューでは @comment 単独行だけ非表示にする（編集テキストは無関係）
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
  const nodes: Node[] = sortDomOrder([...textTargets, ...spanAnchors, ...htmlCommentAnchors]);

  for (const node of nodes) {
    // A) Element
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;

      // 文字列行かどうか
      const isTextLine = ((el.textContent || '').trim().includes(COMMENT_TEXT_MARKER));

      // A-1) 文字列 @comment 行
      if (isTextLine) {
        if (el.getAttribute(COMMENT_MOUNTED_ATTR) === '1') continue;

        const parent = el.parentNode;
        if (!parent) continue;

        const mount = createCommentMountEl();
        parent.insertBefore(mount, el);

        // ★追加：ビューでは @comment 単独行を消す（完全一致のみ）
        hideMarkerLineIfExact(el, COMMENT_TEXT_MARKER);

        el.setAttribute(COMMENT_MOUNTED_ATTR, '1');
        placeholders.push({ placeholderIndex: idx++, mountEl: mount });
        continue;
      }

      // A-2) サーバ span(data-inline-comment)
      if (el.matches('span[data-inline-comment]')) {
        if (el.getAttribute(COMMENT_MOUNTED_ATTR) === '1') continue;

        const parent = el.parentNode;
        if (!parent) continue;

        const mount = createCommentMountEl();
        parent.insertBefore(mount, el);

        // 任意：アンカーspan自体が見えて邪魔なら隠す（表示上は不要）
        el.style.setProperty('display', 'none', 'important');

        el.setAttribute(COMMENT_MOUNTED_ATTR, '1');
        placeholders.push({ placeholderIndex: idx++, mountEl: mount });
        continue;
      }

      continue;
    }

    // B) HTML Comment node
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


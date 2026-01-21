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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 要素 el の中から marker を含む Textノードを探し、
 * 最初の出現（"@comment" / '@comment' / “@comment” 等も含む）を返す
 */
function findFirstMarkerTextNode(
  el: HTMLElement,
  marker: string
): { node: Text; index: number; length: number } | null {
  // 例: "@comment" / '@comment' / “@comment” / @comment（空白挟みも許容）
  const re = new RegExp(`["'“”]?\\s*${escapeRegExp(marker)}\\s*["'“”]?`);

  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const parent = (n as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('.inline-comment-mount, .inline-article-mount')) return NodeFilter.FILTER_REJECT;
      if (isInNoTouchArea(parent)) return NodeFilter.FILTER_REJECT;

      const v = (n.nodeValue || '');
      return re.test(v) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });

  while (tw.nextNode()) {
    const t = tw.currentNode as Text;
    const v = t.nodeValue || '';
    const m = re.exec(v);
    if (!m) continue;
    return { node: t, index: m.index, length: m[0].length };
  }

  return null;
}

/**
 * marker を含む Textノードを分割して、
 * その位置に mount を挿入し、marker文字列（引用符込み）を DOM から除去する
 */
function insertMountAtMarker(el: HTMLElement, marker: string, mount: HTMLElement): boolean {
  const hit = findFirstMarkerTextNode(el, marker);
  if (!hit) return false;

  const { node, index, length } = hit;

  // [before][match][after]
  const matchNode = node.splitText(index);
  const afterNode = matchNode.splitText(length);

  const parent = matchNode.parentNode;
  if (!parent) return false;

  // mount を match の直前に挿入（= ちょうど "@comment" 行の位置）
  parent.insertBefore(mount, matchNode);

  // match（"@comment" 等）を削除
  parent.removeChild(matchNode);

  // 後ろの先頭空白を軽く削る
  if (afterNode.nodeValue) {
    afterNode.nodeValue = afterNode.nodeValue.replace(/^\s+/, '');
  }

  // <br><br> になって空行が増えたら片方消す
  const prev = mount.previousSibling;
  const next = mount.nextSibling;
  const prevIsBr = prev && prev.nodeType === Node.ELEMENT_NODE && (prev as Element).tagName === 'BR';
  const nextIsBr = next && next.nodeType === Node.ELEMENT_NODE && (next as Element).tagName === 'BR';
  if (prevIsBr && nextIsBr) {
    try { (next as Element).remove(); } catch { /* noop */ }
  }

  return true;
}

/**
 * el 内の marker をすべて処理して mount を複数挿入する
 * - 戻り値: 挿入した mount の配列
 */
function insertAllMountsForMarker(
  el: HTMLElement,
  marker: string,
  createMount: () => HTMLElement
): HTMLElement[] {
  const mounts: HTMLElement[] = [];

  // 同一要素内に複数 marker があり得るので繰り返す
  // 無限ループ防止に safety
  let safety = 0;
  while (safety++ < 50) {
    const mount = createMount();
    const ok = insertMountAtMarker(el, marker, mount);
    if (!ok) break;
    mounts.push(mount);
  }

  // marker削除後、要素が実質空でも mount が入っているなら消さない
  const hasMount = !!el.querySelector('.inline-comment-mount, .inline-article-mount');
  const compact = (el.textContent || '').replace(/[\s\u00A0]+/g, '');
  if (!hasMount && compact === '') {
    el.style.setProperty('display', 'none', 'important');
  }

  return mounts;
}

/**
 * @article の位置に記事投稿フォームを表示するための mount を返す
 * - mount は @article の「文字列位置」に挿入（p全体の前ではない）
 * - marker 文字列はビューから除去
 */
export function findArticleMounts(): HTMLElement[] {
  const root = getViewRoot();
  if (!root) return [];

  const targets = findMarkerElements(root, ARTICLE_TEXT_MARKER);
  const mounts: HTMLElement[] = [];

  for (const t of targets) {
    // 要素単位の冪等化（同じ要素を何度も処理しない）
    if (t.getAttribute(ARTICLE_MOUNTED_ATTR) === '1') continue;

    const inserted = insertAllMountsForMarker(t, ARTICLE_TEXT_MARKER, createArticleMountEl);
    mounts.push(...inserted);

    t.setAttribute(ARTICLE_MOUNTED_ATTR, '1');
  }

  return mounts;
}

/**
 * @comment の位置にコメントフォームを表示するための mount を差し込み、
 * placeholderIndex 順に返す
 *
 * - 文字列 @comment はビューから除去（"@comment" 等も除去）
 * - さらに、サーバが置換した <span data-inline-comment="..."></span> も拾う
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

      // A-1) 文字列 @comment を含む（p/li/blockquote）
      if (el.matches('p, li, blockquote')) {
        if (el.getAttribute(COMMENT_MOUNTED_ATTR) === '1') continue;

        const inserted = insertAllMountsForMarker(el, COMMENT_TEXT_MARKER, createCommentMountEl);
        for (const m of inserted) {
          placeholders.push({ placeholderIndex: idx++, mountEl: m });
        }

        el.setAttribute(COMMENT_MOUNTED_ATTR, '1');
        continue;
      }

      // A-2) サーバ span(data-inline-comment)
      if (el.matches('span[data-inline-comment]')) {
        if (el.getAttribute(COMMENT_MOUNTED_ATTR) === '1') continue;

        const parent = el.parentNode;
        if (!parent) continue;

        const mount = createCommentMountEl();
        parent.insertBefore(mount, el);

        // アンカーspanはビューでは不要なので隠す
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


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

// marker の削除を一度だけ行う（冪等化）
const MARKER_REMOVED_ATTR = 'data-inline-marker-removed';

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

/**
 * 文字列中の marker を「トークンとして」見なすための境界チェック
 * - 前後が空白（改行含む） or 端ならOK
 * - 文中の foo@commentbar みたいなのは無視
 */
function isTokenBoundary(text: string, idx: number, len: number): boolean {
  const before = idx === 0 ? '' : text[idx - 1];
  const after = idx + len >= text.length ? '' : text[idx + len];
  const okBefore = before === '' || /\s/.test(before);
  const okAfter = after === '' || /\s/.test(after);
  return okBefore && okAfter;
}

/**
 * 要素 el の中から marker を含む Textノードを探し、最初の出現を返す
 */
function findFirstMarkerTextNode(el: HTMLElement, marker: string): { node: Text; index: number } | null {
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const parent = (n as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest('.inline-comment-mount, .inline-article-mount')) return NodeFilter.FILTER_REJECT;
      if (isInNoTouchArea(parent)) return NodeFilter.FILTER_REJECT;
      if ((n.nodeValue || '').indexOf(marker) === -1) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  while (tw.nextNode()) {
    const t = tw.currentNode as Text;
    const v = t.nodeValue || '';
    const idx = v.indexOf(marker);
    if (idx < 0) continue;
    if (!isTokenBoundary(v, idx, marker.length)) continue;
    return { node: t, index: idx };
  }
  return null;
}

/**
 * marker を含む Textノードを分割して、
 * その位置に mount を挿入し、marker 文字列を DOM から除去する
 */
function insertMountAtMarker(el: HTMLElement, marker: string, mount: HTMLElement): boolean {
  const hit = findFirstMarkerTextNode(el, marker);
  if (!hit) return false;

  const { node, index } = hit;
  const markerLen = marker.length;

  // Text分割: [before][marker][after]
  const markerStart = node.splitText(index);        // markerStart = marker + after
  const afterNode = markerStart.splitText(markerLen); // markerStart = marker のみ

  // mount を marker の直前に挿入
  const parent = markerStart.parentNode;
  if (!parent) return false;

  parent.insertBefore(mount, markerStart);

  // marker文字列は削除
  parent.removeChild(markerStart);

  // 前後の不要な空白だけ軽く整形（強すぎないように）
  if (afterNode.nodeValue) {
    afterNode.nodeValue = afterNode.nodeValue.replace(/^\s+/, '');
  }

  // 「marker が単独行（改行で挟まれてる）」っぽい場合、空行を減らす
  // mount の直前と直後が <br> で並ぶ場合に片方を消す
  const prev = mount.previousSibling;
  const next = mount.nextSibling;

  if (prev && next) {
    const prevIsBr = prev.nodeType === Node.ELEMENT_NODE && (prev as Element).tagName === 'BR';
    const nextIsBr = next.nodeType === Node.ELEMENT_NODE && (next as Element).tagName === 'BR';
    if (prevIsBr && nextIsBr) {
      try { (next as Element).remove(); } catch { /* noop */ }
    }
  }

  return true;
}

/**
 * el 内の marker をすべて処理して mount を複数挿入する
 * - 戻り値: 挿入した mount の配列
 */
function insertAllMountsForMarker(el: HTMLElement, marker: string, createMount: () => HTMLElement): HTMLElement[] {
  const mounts: HTMLElement[] = [];

  // 既に「marker除去済み」なら何もしない（冪等化）
  // ※ mount 追加だけ再実行したい場合があるので、ここでは marker だけの冪等化に留める
  let safety = 0;
  while (safety++ < 50) {
    const mount = createMount();
    const ok = insertMountAtMarker(el, marker, mount);
    if (!ok) break;
    mounts.push(mount);
  }

  // marker が含まれていた要素で、結果として空に近いなら要素ごと隠す
  //（@comment だけの行だった場合の後始末）
  const compact = (el.textContent || '').replace(/[\s\u00A0]+/g, '');
  if (compact === '') {
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

    // @article が 1つの <p> に含まれていても、内部位置に挿入する
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
 * - 文字列 @comment はビューから除去
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
      // ※ 1つの要素内に複数回出る可能性があるため、要素内で全部処理する
      if (el.matches('p, li, blockquote')) {
        if (el.getAttribute(COMMENT_MOUNTED_ATTR) === '1') continue;

        const inserted = insertAllMountsForMarker(el, COMMENT_TEXT_MARKER, createCommentMountEl);
        for (const m of inserted) {
          placeholders.push({ placeholderIndex: idx++, mountEl: m });
        }

        // この要素内の @comment を処理し終えた
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


export type Placeholder = {
  placeholderIndex: number;
  mountEl: HTMLElement;
};

const COMMENT_TEXT_MARKER = '@comment';
const ARTICLE_TEXT_MARKER = '@article';
const COMMENT_MARKER_PREFIX = 'inline-comment:'; // 保険：HTMLコメント形式

// アンカー（不可視）に付ける属性名
const COMMENT_ANCHOR_ATTR = 'data-inline-comment-anchor';
const ARTICLE_ANCHOR_ATTR = 'data-inline-article-anchor';

// アンカーに「mount 済み」を刻む属性
const COMMENT_MOUNTED_ATTR = 'data-inline-comment-mounted';
const ARTICLE_MOUNTED_ATTR = 'data-inline-article-mounted';

// 触らない領域（markdown の code / pre など）
function isInNoTouchArea(el: Element | null): boolean {
  if (!el) return false;
  return !!el.closest('pre, code, kbd, samp');
}

/**
 * プラグインが処理対象にするルート。
 * body 全体を触ると React 管理領域まで巻き込みやすいので、まず wiki 本文に限定する。
 */
function getScanRoot(): Element {
  return (
    document.querySelector('.wiki') ||
    document.querySelector('.markdown-body') ||
    document.querySelector('#content-main') ||
    document.body
  );
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

/**
 * 安全に removeChild
 */
function safeRemoveChild(parent: Node, child: Node) {
  try {
    // contains がある環境なら、親子関係が壊れている場合は何もしない
    const anyParent = parent as any;
    if (typeof anyParent.contains === 'function' && !anyParent.contains(child)) return;
    parent.removeChild(child);
  } catch {
    // noop
  }
}

/**
 * 指定マーカー(@comment/@article)を含むTextノードを分割し、
 * マーカー部分を「見えないアンカー要素」に置換する。
 *
 * - 例: "aaa @comment bbb"
 *   → "aaa " + <span data-... style="display:none"> + " bbb"
 *
 * ★重要: 何度走っても壊れない（冪等）ように、
 *   - pre/code 内は触らない
 *   - 対象を scanRoot に限定
 */
function replaceTextMarkerWithHiddenAnchors(
  marker: string,
  anchorAttrName: string
): HTMLElement[] {
  const anchors: HTMLElement[] = [];
  const scanRoot = getScanRoot();

  const walker = document.createTreeWalker(
    scanRoot,
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

      // 途中で親が差し替わる可能性があるので、毎回 contains を確認
      const anyParent = parent as any;
      if (typeof anyParent.contains === 'function' && !anyParent.contains(cur)) break;

      const before = s.slice(0, pos);
      const after = s.slice(pos + marker.length);

      if (before.length > 0) {
        parent.insertBefore(document.createTextNode(before), cur);
      }

      // アンカー
      const anchor = document.createElement('span');
      anchor.setAttribute(anchorAttrName, '1');
      anchor.style.display = 'none';
      parent.insertBefore(anchor, cur);
      anchors.push(anchor);

      // 残りを newText にして cur を置き換え（cur は安全に remove）
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
 * DOM順ソート（Node.compareDocumentPosition を利用）
 */
function sortDomOrder(nodes: Node[]): Node[] {
  return nodes.sort((a, b) => {
    if (a === b) return 0;
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    return 1;
  });
}

/**
 * @article の位置に記事投稿フォームを表示するための mount を返す
 */
export function findArticleMounts(): HTMLElement[] {
  // まず @article の文字を見えないアンカーへ
  replaceTextMarkerWithHiddenAnchors(ARTICLE_TEXT_MARKER, ARTICLE_ANCHOR_ATTR);

  // 既存アンカー収集（テキスト置換由来 + 既存DOM由来）
  const scanRoot = getScanRoot();
  const anchors = Array.from(
    scanRoot.querySelectorAll<HTMLElement>(`span[${ARTICLE_ANCHOR_ATTR}]`)
  );

  const mounts: HTMLElement[] = [];

  for (const a of anchors) {
    // 既に mount 済みなら何もしない（★近傍判定ではなくアンカーに刻む）
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
  const placeholders: Placeholder[] = [];
  let idx = 0;

  // A) まず @comment の文字を見えないアンカーへ
  replaceTextMarkerWithHiddenAnchors(COMMENT_TEXT_MARKER, COMMENT_ANCHOR_ATTR);

  const scanRoot = getScanRoot();

  // B) リレー側が置換した span(data-inline-comment="...") も拾う
  const spanAnchors = Array.from(
    scanRoot.querySelectorAll<HTMLElement>(`span[data-inline-comment], span[${COMMENT_ANCHOR_ATTR}]`)
  );

  // C) さらに保険で HTMLコメント <!-- inline-comment:... --> を拾う
  const commentWalker = document.createTreeWalker(scanRoot, NodeFilter.SHOW_COMMENT, null);
  const htmlCommentAnchors: Comment[] = [];
  while (commentWalker.nextNode()) {
    const c = commentWalker.currentNode as Comment;
    if ((c.nodeValue ?? '').includes(COMMENT_MARKER_PREFIX)) {
      htmlCommentAnchors.push(c);
    }
  }

  // D) 全アンカーをDOM順でまとめる
  const allAnchors: Node[] = sortDomOrder([...spanAnchors, ...htmlCommentAnchors]);

  // E) DOM順に mount を差し込み、placeholderIndex を付与
  for (const node of allAnchors) {
    // span アンカーの場合は、アンカー自身に mounted フラグを刻む
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;

      // mount 自体や code/pre 内は触らない
      if (el.closest('.inline-comment-mount') || el.closest('.inline-article-mount')) continue;
      if (isInNoTouchArea(el)) continue;

      if (el.getAttribute(COMMENT_MOUNTED_ATTR) === '1') {
        continue;
      }

      const parent = el.parentNode;
      if (!parent) continue;

      const mount = createCommentMountEl();
      parent.insertBefore(mount, el);

      el.setAttribute(COMMENT_MOUNTED_ATTR, '1');

      placeholders.push({
        placeholderIndex: idx++,
        mountEl: mount,
      });

      continue;
    }

    // HTMLコメント（Commentノード）の場合：属性が付けられないので、
    // 前に span マーカーを差し込んでそれに mounted フラグを刻む（冪等化）
    if (node.nodeType === Node.COMMENT_NODE) {
      const c = node as Comment;
      const parent = c.parentNode;
      if (!parent) continue;

      // 直前に “管理用span” があるなら再利用
      const prev = c.previousSibling;
      if (prev && prev.nodeType === Node.ELEMENT_NODE) {
        const prevEl = prev as HTMLElement;
        if (prevEl.getAttribute('data-inline-comment-html-anchor') === '1') {
          if (prevEl.getAttribute(COMMENT_MOUNTED_ATTR) === '1') continue;

          const mount = createCommentMountEl();
          parent.insertBefore(mount, c);

          prevEl.setAttribute(COMMENT_MOUNTED_ATTR, '1');
          placeholders.push({ placeholderIndex: idx++, mountEl: mount });
          continue;
        }
      }

      // 新規に管理用spanを追加
      const guard = document.createElement('span');
      guard.setAttribute('data-inline-comment-html-anchor', '1');
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


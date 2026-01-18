import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { findAndMountPlaceholders, findArticleMounts } from './src/dom';
import { InlineCommentForm } from './src/InlineCommentForm';
import { ArticlePostForm } from './src/ArticlePostForm';

console.log('[inline-comment] client-entry loaded');

type GrowiFacade = any;

// nginx等で同一ドメイン配下に置く想定
// コメント: POST `${BASE}/`
// 記事: POST `${BASE}/article`
const BASE = '/growi-comment-inline';

function getPagePath(): string {
  return decodeURIComponent(location.pathname);
}

/**
 * 編集画面（エディタ/プレビュー）ではプラグインを動かさない。
 * React管理DOMを直接触る系のプラグインは編集画面で衝突しやすく、
 * removeChild NotFoundError の原因になるため。
 */
function isEditLikePage(): boolean {
  // 1) URLでの判定（環境差があるので広めに拾う）
  const url = `${location.pathname}${location.search}`.toLowerCase();

  // ありがちな編集URLパターンを広めに
  if (
    url.includes('/_edit') ||
    url.includes('/edit') ||
    url.includes('edit=') ||
    url.includes('mode=edit') ||
    url.includes('isedit') ||
    url.includes('pageeditor')
  ) {
    return true;
  }

  // 2) DOMでの判定（編集画面に出がちなもの）
  // textarea が存在し、かつ editor/toolbar っぽい要素があるなら編集画面扱い
  const hasTextarea = !!document.querySelector('textarea');
  if (!hasTextarea) return false;

  const hasEditorHint =
    !!document.querySelector('[data-testid*="editor"]') ||
    !!document.querySelector('[data-testid*="toolbar"]') ||
    !!document.querySelector('[class*="Editor"]') ||
    !!document.querySelector('[class*="PageEditor"]') ||
    !!document.querySelector('[class*="MarkdownEditor"]') ||
    !!document.querySelector('[class*="toolbar"]');

  return hasTextarea && hasEditorHint;
}

/**
 * 同一DOMに二重で createRoot しない（StrictMode/再マウント/SPA遷移対策）
 */
const roots = new WeakMap<Element, Root>();
function getOrCreateRoot(el: Element): Root {
  const existing = roots.get(el);
  if (existing) return existing;
  const root = createRoot(el);
  roots.set(el, root);
  return root;
}

function mountOnce() {
  const path = getPagePath();

  // ===== 記事投稿フォーム（@article） =====
  const articleMounts = findArticleMounts();
  for (const mount of articleMounts) {
    if (mount.dataset.mounted) continue;
    mount.dataset.mounted = '1';

    const root = getOrCreateRoot(mount);
    root.render(<ArticlePostForm endpoint={`${BASE}/article`} path={path} />);
  }

  // ===== コメントフォーム（@comment） =====
  const placeholders = findAndMountPlaceholders();
  for (const p of placeholders) {
    // p.mountEl が同じ要素を指し続ける可能性があるので root を使い回す
    const root = getOrCreateRoot(p.mountEl);
    root.render(
      <InlineCommentForm
        endpoint={`${BASE}/`}
        path={path}
        placeholderIndex={p.placeholderIndex}
      />,
    );
  }
}

// DOM差し替えが連続するのでdebounce
let timer: number | undefined;
function scheduleMount() {
  if (timer != null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    try {
      // activate 側でガードしているが、念のため二重ガード
      if (isEditLikePage()) return;
      mountOnce();
    } catch {
      // noop
    }
  }, 50);
}

let observer: MutationObserver | null = null;

const activate = (_growiFacade: GrowiFacade): void => {
  // ★編集画面では何もしない（ここが本命）
  if (isEditLikePage()) {
    console.log('[inline-comment] skip on edit page');
    return;
  }

  // 初回 + 数回だけ遅延再試行（SPA/遅延描画対策）
  scheduleMount();
  window.setTimeout(scheduleMount, 200);
  window.setTimeout(scheduleMount, 800);

  // 監視（閲覧画面のみ）
  observer = new MutationObserver(() => scheduleMount());
  observer.observe(document.body, { childList: true, subtree: true });
};

const deactivate = (): void => {
  // observer 停止
  if (observer) {
    try {
      observer.disconnect();
    } catch {
      // noop
    }
    observer = null;
  }

  // タイマー停止
  if (timer != null) {
    try {
      window.clearTimeout(timer);
    } catch {
      // noop
    }
    timer = undefined;
  }

  // root は WeakMap なので解放はブラウザに任せる
};

declare global {
  interface Window {
    pluginActivators?: Record<string, any>;
  }
}

window.pluginActivators ??= {};
window.pluginActivators['growi-plugin-inline-comment'] = { activate, deactivate };


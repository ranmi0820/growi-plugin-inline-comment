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
 * 編集画面（#edit 等）ではプラグインを動かさない
 */
function isEditLikePage(): boolean {
  const pathSearch = `${location.pathname}${location.search}`.toLowerCase();
  const hash = (location.hash || '').toLowerCase(); // ★重要：#edit を見る

  // あなたの環境： /<pageId>#edit
  if (hash === '#edit' || hash.startsWith('#edit')) return true;

  // 保険：URLに edit 系が含まれるパターンも拾う
  if (
    pathSearch.includes('/_edit') ||
    pathSearch.includes('/edit') ||
    pathSearch.includes('edit=') ||
    pathSearch.includes('mode=edit')
  ) {
    return true;
  }

  // DOM でも保険（編集画面に textarea がある場合など）
  // ※ ここは環境差があるので「補助」扱い
  const hasTextarea = !!document.querySelector('textarea');
  if (hasTextarea) {
    const hasEditorHint =
      !!document.querySelector('[data-testid*="editor"]') ||
      !!document.querySelector('[data-testid*="toolbar"]') ||
      !!document.querySelector('[class*="Editor"]') ||
      !!document.querySelector('[class*="PageEditor"]') ||
      !!document.querySelector('[class*="MarkdownEditor"]') ||
      !!document.querySelector('[class*="toolbar"]');
    if (hasEditorHint) return true;
  }

  return false;
}

/**
 * 二重 createRoot 防止 & 後で unmount できるように追跡
 */
const roots = new WeakMap<Element, Root>();
const mountedEls = new Set<Element>();

function getOrCreateRoot(el: Element): Root {
  const existing = roots.get(el);
  if (existing) return existing;
  const root = createRoot(el);
  roots.set(el, root);
  return root;
}

function unmountAll() {
  for (const el of Array.from(mountedEls)) {
    try {
      const root = roots.get(el);
      root?.unmount();
    } catch {
      // noop
    }
    mountedEls.delete(el);
  }
}

/**
 * 実際のマウント処理（閲覧画面のみ）
 */
function mountOnce() {
  const path = getPagePath();

  // ===== 記事投稿フォーム（@article） =====
  const articleMounts = findArticleMounts();
  for (const mount of articleMounts) {
    if (mount.dataset.mounted) continue;
    mount.dataset.mounted = '1';

    const root = getOrCreateRoot(mount);
    root.render(<ArticlePostForm endpoint={`${BASE}/article`} path={path} />);
    mountedEls.add(mount);
  }

  // ===== コメントフォーム（@comment） =====
  const placeholders = findAndMountPlaceholders();
  for (const p of placeholders) {
    // 同じ mountEl に対して二重 root を作らない
    const root = getOrCreateRoot(p.mountEl);
    root.render(
      <InlineCommentForm
        endpoint={`${BASE}/`}
        path={path}
        placeholderIndex={p.placeholderIndex}
      />,
    );
    mountedEls.add(p.mountEl);
  }
}

// DOM差し替えが連続するので debounce
let timer: number | undefined;
function clearTimer() {
  if (timer != null) {
    try {
      window.clearTimeout(timer);
    } catch {
      // noop
    }
    timer = undefined;
  }
}

function scheduleMount() {
  clearTimer();
  timer = window.setTimeout(() => {
    try {
      // ★ここでも毎回編集判定して止める
      if (isEditLikePage()) {
        stopRunning(); // 編集に入った瞬間に確実に止める
        return;
      }
      mountOnce();
    } catch {
      // noop
    }
  }, 50);
}

let observer: MutationObserver | null = null;
let started = false;

function stopRunning() {
  // observer 停止
  if (observer) {
    try {
      observer.disconnect();
    } catch {
      // noop
    }
    observer = null;
  }

  clearTimer();

  // ★既に挿入した React を外す（編集画面にDOM改変を持ち込まない）
  unmountAll();

  started = false;
}

function startRunning() {
  if (started) return;
  if (isEditLikePage()) return;

  started = true;

  // 初回 + 少し遅延して再試行（SPA/遅延描画対策）
  scheduleMount();
  window.setTimeout(scheduleMount, 200);
  window.setTimeout(scheduleMount, 800);

  observer = new MutationObserver(() => scheduleMount());
  observer.observe(document.body, { childList: true, subtree: true });
}

function handleLocationMaybeChanged() {
  // ★ハッシュ遷移（#edit）で編集に入るので、必ずここで停止
  if (isEditLikePage()) {
    stopRunning();
  } else {
    // 閲覧に戻ったら再開（不要なら消してもOK）
    startRunning();
  }
}

const activate = (_growiFacade: GrowiFacade): void => {
  // 最初から編集なら何もしない
  if (isEditLikePage()) {
    console.log('[inline-comment] skip on edit page');
    stopRunning();
    return;
  }

  startRunning();

  // ★#edit 切り替えを捕まえる
  window.addEventListener('hashchange', handleLocationMaybeChanged);

  // SPA遷移やブラウザ戻る/進むでも止めたいので保険
  window.addEventListener('popstate', handleLocationMaybeChanged);
};

const deactivate = (): void => {
  window.removeEventListener('hashchange', handleLocationMaybeChanged);
  window.removeEventListener('popstate', handleLocationMaybeChanged);
  stopRunning();
};

declare global {
  interface Window {
    pluginActivators?: Record<string, any>;
  }
}

window.pluginActivators ??= {};
window.pluginActivators['growi-plugin-inline-comment'] = { activate, deactivate };


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
 * ★編集画面判定は「#edit だけ」に絞る
 * これ以外（textarea 等）で判定するとビューでも誤判定してフォームが消えることがある。
 */
function isEditLikePage(): boolean {
  const hash = (location.hash || '').toLowerCase();
  return hash === '#edit' || hash.startsWith('#edit');
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
      // ★毎回 #edit を見て、編集なら止める
      if (isEditLikePage()) {
        stopRunning();
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
  if (observer) {
    try {
      observer.disconnect();
    } catch {
      // noop
    }
    observer = null;
  }

  clearTimer();

  // ★編集に入ったら外す（ビューへ戻ればまた mount される）
  unmountAll();

  started = false;
}

function startRunning() {
  if (started) return;
  if (isEditLikePage()) return;

  started = true;

  // 初回 + 数回だけ遅延再試行（SPA/遅延描画対策）
  scheduleMount();
  window.setTimeout(scheduleMount, 200);
  window.setTimeout(scheduleMount, 800);

  observer = new MutationObserver(() => scheduleMount());
  observer.observe(document.body, { childList: true, subtree: true });
}

function handleHashChanged() {
  // ★#edit の ON/OFF に追従して start/stop
  if (isEditLikePage()) {
    stopRunning();
  } else {
    startRunning();
  }
}

const activate = (_growiFacade: GrowiFacade): void => {
  if (isEditLikePage()) {
    console.log('[inline-comment] skip on edit page');
    stopRunning();
  } else {
    startRunning();
  }

  // ★あなたの環境は #edit なので hashchange を監視すれば十分
  window.addEventListener('hashchange', handleHashChanged);
};

const deactivate = (): void => {
  window.removeEventListener('hashchange', handleHashChanged);
  stopRunning();
};

declare global {
  interface Window {
    pluginActivators?: Record<string, any>;
  }
}

window.pluginActivators ??= {};
window.pluginActivators['growi-plugin-inline-comment'] = { activate, deactivate };


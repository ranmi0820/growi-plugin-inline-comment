import React from 'react';
import { createRoot } from 'react-dom/client';
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

function mountOnce() {
  const path = getPagePath();

  // ===== 記事投稿フォーム（@article） =====
  const articleMounts = findArticleMounts();
  for (const mount of articleMounts) {
    if (mount.dataset.mounted) continue;
    mount.dataset.mounted = '1';

    const root = createRoot(mount);
    root.render(<ArticlePostForm endpoint={`${BASE}/article`} path={path} />);
  }

  // ===== コメントフォーム（@comment） =====
  const placeholders = findAndMountPlaceholders();
  for (const p of placeholders) {
    const root = createRoot(p.mountEl);
    root.render(
      <InlineCommentForm
        endpoint={`${BASE}/`}
        path={path}
        placeholderIndex={p.placeholderIndex}
      />
    );
  }
}

// DOM差し替えが連続するのでdebounce
let timer: number | undefined;
function scheduleMount() {
  if (timer != null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    try {
      mountOnce();
    } catch {
      // noop
    }
  }, 50);
}

const activate = (_growiFacade: GrowiFacade): void => {
  scheduleMount();
  window.setTimeout(scheduleMount, 200);
  window.setTimeout(scheduleMount, 800);

  const obs = new MutationObserver(() => scheduleMount());
  obs.observe(document.body, { childList: true, subtree: true });
};

const deactivate = (): void => {};

declare global {
  interface Window {
    pluginActivators?: Record<string, any>;
  }
}

window.pluginActivators ??= {};
window.pluginActivators['growi-plugin-inline-comment'] = { activate, deactivate };


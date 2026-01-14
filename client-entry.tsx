import React from 'react';
import { createRoot } from 'react-dom/client';
import { findAndMountPlaceholders } from './src/dom';
import { InlineCommentForm } from './src/InlineCommentForm';

console.log('[inline-comment] client-entry loaded');

type GrowiFacade = any;

// 中継API（nginxでGROWIと同一ドメイン配下に置くのがおすすめ）
const ENDPOINT = '/growi-comment-inline/';

function getPagePath(): string {
  return decodeURIComponent(location.pathname);
}

function mountOnce() {
  const path = getPagePath();
  const placeholders = findAndMountPlaceholders();

  for (const p of placeholders) {
    const root = createRoot(p.mountEl);
    root.render(
      <InlineCommentForm
        endpoint={ENDPOINT}
        path={path}
        placeholderIndex={p.placeholderIndex}
      />
    );
  }
}

// 連続DOM更新対策：debounceしてまとめてmount
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

const activate = (growiFacade: GrowiFacade): void => {
  console.log('[inline-comment] activate called', { growiFacade });

  // 初回：即時＆遅延でも試す（描画タイミングの揺れ対策）
  scheduleMount();
  window.setTimeout(scheduleMount, 200);
  window.setTimeout(scheduleMount, 800);

  // 本命：SPA遷移/編集保存後のDOM差し替えを監視して都度mount
  const obs = new MutationObserver(() => scheduleMount());
  obs.observe(document.body, { childList: true, subtree: true });

  // deactivateで止めたい場合は growiFacade等に保持して解除してください
};

const deactivate = (): void => {};

declare global {
  interface Window {
    pluginActivators?: Record<string, any>;
  }
}

window.pluginActivators ??= {};
window.pluginActivators['growi-plugin-inline-comment'] = { activate, deactivate };


import React from 'react';
import { createRoot } from 'react-dom/client';
import { findAndMountPlaceholders } from './src/dom';
import { InlineCommentForm } from './src/InlineCommentForm';

console.log('[inline-comment] client-entry loaded');

type GrowiFacade = any;

// 中継API（後でnginxでGROWIと同一ドメイン配下に置くのがおすすめ）
const ENDPOINT = '/growi-comment-inline';

function getPagePath(): string {
  // GROWIのURLに合わせて必要なら調整
  return decodeURIComponent(location.pathname);
}

function mount() {
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

const activate = (growiFacade: GrowiFacade): void => {
  // 描画が落ち着いてから
  console.log('[inline-comment] activate called', { growiFacade });
  setTimeout(() => {
    try {
      mount();
    } catch {
      // 何もしない
    }
  }, 0);
};

const deactivate = (): void => {};

declare global {
  interface Window {
    pluginActivators?: Record<string, any>;
  }
}

window.pluginActivators ??= {};
window.pluginActivators['growi-plugin-inline-comment'] = { activate, deactivate };


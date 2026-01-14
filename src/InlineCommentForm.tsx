import React from 'react';

type Props = {
  endpoint: string;
  path: string;
  placeholderIndex: number;
};

export function InlineCommentForm({ endpoint, path, placeholderIndex }: Props) {
  const [name, setName] = React.useState('');
  const [text, setText] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    const n = name.trim();
    const t = text.trim();

    if (!t) {
      setStatus('コメントが空です');
      return;
    }

    try {
      setBusy(true);
      setStatus('送信中...');

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path,
          placeholderIndex,
          name: n,
          text: t,
        }),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `HTTP ${res.status}`);
      }

      // ここで画面更新する
      setStatus('投稿しました。更新します...');
      // 入力クリア（任意）
      setText('');

      // 少しだけ待ってからリロード（ステータス表示が一瞬見える）
      window.setTimeout(() => {
        window.location.reload();
      }, 150);

    } catch (e: any) {
      setStatus(`失敗: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input
        style={{ width: 140 }}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="名前（任意）"
        disabled={busy}
      />
      <input
        style={{ flex: 1 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="コメント"
        disabled={busy}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit();
        }}
      />
      <button type="button" onClick={submit} disabled={busy}>
        コメントの挿入
      </button>
      <span style={{ fontSize: 12, opacity: 0.8 }}>{status}</span>
    </div>
  );
}


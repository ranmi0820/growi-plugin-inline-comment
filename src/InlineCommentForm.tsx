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

  const submit = async () => {
    const n = name.trim();
    const t = text.trim();
    if (t.length === 0) return;

    setStatus('投稿中…');

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
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

      setStatus('投稿しました。更新します…');
      location.reload();
    } catch (e: any) {
      setStatus(`失敗: ${e?.message ?? e}`);
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span>お名前:</span>
      <input
        style={{ width: 150 }}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="任意"
      />
      <input
        style={{ flex: 1 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="コメント"
      />
      <button type="button" onClick={submit}>
        コメントの挿入
      </button>
      <span style={{ fontSize: 12, opacity: 0.8 }}>{status}</span>
    </div>
  );
}


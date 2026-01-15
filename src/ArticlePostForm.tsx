import React from 'react';

type Props = {
  endpoint: string; // 例: /growi-comment-inline/article
  path: string;
};

export function ArticlePostForm({ endpoint, path }: Props) {
  const [name, setName] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    const n = name.trim();
    const t = title.trim();
    const b = body;

    if (!t) {
      setStatus('題名が空です');
      return;
    }
    if (!b.trim()) {
      setStatus('本文が空です');
      return;
    }

    try {
      setBusy(true);
      setStatus('投稿中...');

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path,
          name: n,
          title: t,
          body: b,
        }),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `HTTP ${res.status}`);
      }

      setStatus('投稿しました。更新します...');
      setBody('');

      // 投稿内容＋末尾@commentを反映するためリロード
      window.setTimeout(() => {
        window.location.reload();
      }, 200);

    } catch (e: any) {
      setStatus(`失敗: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ border: '1px solid #ccc', padding: 10, borderRadius: 4 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <label style={{ width: 70 }}>お名前:</label>
        <input
          style={{ width: 220 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder=""
          disabled={busy}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <label style={{ width: 70 }}>題名:</label>
        <input
          style={{ flex: 1 }}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder=""
          disabled={busy}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{ width: 70 }} />
        <textarea
          style={{ flex: 1, height: 260 }}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder=""
          disabled={busy}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" onClick={submit} disabled={busy}>
          記事の投稿
        </button>
        <span style={{ fontSize: 12, opacity: 0.8 }}>{status}</span>
      </div>
    </div>
  );
}


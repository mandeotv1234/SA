import React from 'react';

export default function InsightsPanel({ authFetch }) {
  const [insights, setInsights] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [selected, setSelected] = React.useState(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      // request only per-event causal predictions (not the scheduled summaries)
      const res = await authFetch('/v1/insights?type=causal_event&limit=20');
      if (!res.ok) throw new Error('fetch failed ' + res.status);
      const j = await res.json();
      setInsights(j.rows || []);
    } catch (e) {
      console.error('Failed loading insights', e);
    } finally { setLoading(false); }
  }, [authFetch]);

  React.useEffect(() => { load(); }, [load]);

  const formatDirection = (ret) => {
    if (ret === null || ret === undefined) return { label: 'N/A', color: '#666' };
    const pct = Number(ret);
    if (isNaN(pct)) return { label: 'N/A', color: '#666' };
    if (pct > 0) return { label: `TĂNG ${(pct * 100).toFixed(2)}%`, color: '#0b6623' };
    if (pct < 0) return { label: `GIẢM ${(Math.abs(pct) * 100).toFixed(2)}%`, color: '#b22222' };
    return { label: 'KHÔNG ĐỔI', color: '#666' };
  };

  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
      <div style={{ width: 360, border: '1px solid #eee', padding: 8, borderRadius: 6 }}>
        <div style={{ marginBottom: 8 }}>
          <strong>Insights</strong>
          <button style={{ float: 'right' }} onClick={load}>{loading ? '...' : 'Refresh'}</button>
        </div>
        <div style={{ maxHeight: 420, overflow: 'auto' }}>
          {insights.length === 0 && !loading && <div style={{ padding: 8 }}>No insights yet</div>}
          {insights.map((it, idx) => (
            <div key={idx} onClick={() => setSelected(it)} style={{ padding: 8, borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }}>
              <div style={{ fontSize: 13, color: '#333' }}>{it.payload && it.payload.title ? it.payload.title : (it.payload && it.payload.summary) || 'Insight'}</div>
              <div style={{ fontSize: 12, color: '#666' }}>{new Date(it.time).toLocaleString()} · {it.type}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, border: '1px solid #eee', padding: 12, borderRadius: 6 }}>
        {selected ? (
          <div>
            <h3 style={{ marginTop: 0 }}>{selected.payload.title || selected.payload.summary}</h3>
            {/* derive return_pct from a few possible shapes */}
            {(() => {
              const p = selected.payload || {};
              const ret = p.return_pct ?? (p.insight && p.insight.return_pct) ?? (p.payload && p.payload.return_pct) ?? null;
              const conf = p.confidence ?? (p.insight && p.insight.confidence) ?? null;
              const sym = p.symbol ?? (p.insight && p.insight.symbol) ?? null;
              const rationale = p.rationale ?? (p.insight && p.insight.rationale) ?? (p.explanation && p.explanation.rationale) ?? null;
              const dir = formatDirection(ret);
              return (
                <div>
                  <div style={{ marginBottom: 8 }}><strong>Dự đoán:</strong> <span style={{ color: dir.color }}>{dir.label}</span></div>
                  <div style={{ marginBottom: 8 }}><strong>Confidence:</strong> {conf ?? 'N/A'}</div>
                  <div style={{ marginBottom: 8 }}><strong>Symbol:</strong> {sym || 'N/A'}</div>
                  {rationale && (
                    <div style={{ marginTop: 8, padding: 8, background: '#fafafa', borderRadius: 4 }}>
                      <strong>Lý do (tóm tắt):</strong>
                      <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{rationale}</div>
                    </div>
                  )}
                </div>
              );
            })()}
            <div style={{ marginTop: 12 }}>
              <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto', background: '#fafafa', padding: 8 }}>{JSON.stringify(selected.payload.explanation || selected.payload, null, 2)}</pre>
            </div>
            {selected.payload && selected.payload.raw_news && selected.payload.raw_news.url && (
              <div style={{ marginTop: 8 }}><a href={selected.payload.raw_news.url} target="_blank" rel="noreferrer">Open article</a></div>
            )}
          </div>
        ) : (
          <div style={{ color: '#666' }}>Select an insight to view details</div>
        )}
      </div>
    </div>
  );
}

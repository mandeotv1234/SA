import React, { useEffect, useState } from 'react';
import useStore from '../store';
import { ArrowUp, ArrowDown, Minus, TrendingUp, TrendingDown } from 'lucide-react';

export default function InsightsList() {
    const { authFetch, symbol } = useStore();
    const [insights, setInsights] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState(null);

    useEffect(() => {
        loadInsights();
    }, [symbol]);

    const loadInsights = async () => {
        setLoading(true);
        try {
            const res = await authFetch(`/v1/insights?type=causal_event&limit=20`);
            if (res.ok) {
                const data = await res.json();
                // Filter by current symbol if available
                const rows = data.rows || [];
                const filtered = symbol
                    ? rows.filter(r => {
                        const p = r.payload || {};
                        const i = p.insight || p;
                        return !i.symbol || i.symbol === symbol;
                    })
                    : rows;
                setInsights(filtered);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const getDirectionIcon = (direction, ret) => {
        if (direction === 'UP' || ret > 0) return <TrendingUp size={16} style={{ color: 'var(--accent-green)' }} />;
        if (direction === 'DOWN' || ret < 0) return <TrendingDown size={16} style={{ color: 'var(--accent-red)' }} />;
        return <Minus size={16} style={{ color: '#777' }} />;
    };

    const formatPrediction = (insight) => {
        const direction = insight.prediction_direction;
        const pct = insight.predicted_change_pct;
        const isPrediction = insight.is_prediction;

        if (isPrediction && direction) {
            const sign = direction === 'UP' ? '+' : direction === 'DOWN' ? '' : '';
            const pctStr = pct !== undefined && pct !== null ? `${sign}${pct.toFixed(1)}%` : '';
            const dirLabel = direction === 'UP' ? 'TĂNG' : direction === 'DOWN' ? 'GIẢM' : 'ĐI NGANG';
            return { label: dirLabel, pct: pctStr };
        }

        // Fallback for non-predictions or old data
        const ret = insight.return_pct ?? 0;
        return { label: ret > 0 ? 'TĂNG' : ret < 0 ? 'GIẢM' : 'ĐI NGANG', pct: (ret * 100).toFixed(2) + '%' };
    };

    return (
        <div style={{ padding: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, padding: '0 4px' }}>
                <span style={{ fontSize: '10px', color: 'var(--accent-yellow)', fontWeight: 'bold' }}>
                    AI PREDICTIONS {symbol && `(${symbol})`}
                </span>
                <button onClick={loadInsights} style={{ background: 'none', border: 'none', color: 'var(--accent-blue)', fontSize: '10px', cursor: 'pointer' }}>Refresh</button>
            </div>

            {loading && <div className="loading-text">Analyzing market events...</div>}

            {insights.map((item, idx) => {
                const p = item.payload || {};
                const insight = p.insight || p;
                const title = insight.title || p.title || item.topic;
                const direction = insight.prediction_direction;
                const ret = insight.return_pct ?? 0;
                const rationale = insight.rationale;
                const isPrediction = insight.is_prediction;
                const { label, pct } = formatPrediction(insight);

                const color = direction === 'UP' || ret > 0
                    ? 'var(--accent-green)'
                    : direction === 'DOWN' || ret < 0
                        ? 'var(--accent-red)'
                        : '#777';

                return (
                    <div key={idx} className="insight-item">
                        <div className="insight-header" onClick={() => setSelected(selected === idx ? null : idx)}>
                            <div className="insight-meta">
                                <span>{new Date(item.created_at || item.time).toLocaleTimeString()}</span>
                                <div className="insight-badge" style={{ color, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    {getDirectionIcon(direction, ret)}
                                    <span style={{ fontWeight: 'bold' }}>{label}</span>
                                    {isPrediction && pct && <span style={{ fontSize: '11px' }}>{pct}</span>}
                                </div>
                            </div>
                            <div className="insight-title">{title}</div>
                        </div>

                        {selected === idx && (
                            <div className="insight-detail">
                                {rationale ? (
                                    <div className="rationale" style={{
                                        background: 'rgba(255,255,255,0.05)',
                                        padding: 12,
                                        borderRadius: 8,
                                        borderLeft: `3px solid ${color}`,
                                        marginBottom: 8
                                    }}>
                                        <div style={{ fontSize: '11px', color: '#999', marginBottom: 4 }}>
                                            📊 Phân tích AI:
                                        </div>
                                        <div style={{ fontSize: '13px', lineHeight: 1.5 }}>{rationale}</div>
                                    </div>
                                ) : (
                                    <div style={{ color: '#777' }}>Chưa có phân tích chi tiết.</div>
                                )}
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, color: '#777', fontSize: '11px' }}>
                                    <div>Độ tin cậy: {((insight.confidence || 0) * 100).toFixed(0)}%</div>
                                    <div>Cặp: {insight.symbol || 'N/A'}</div>
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}

            {!loading && insights.length === 0 && (
                <div style={{ textAlign: 'center', color: '#666', padding: 20, fontSize: '12px' }}>
                    Chưa có dữ liệu dự đoán cho {symbol || 'cặp tiền này'}
                </div>
            )}
        </div>
    );
}

import React from 'react';

/**
 * MarketPredictions component displays aggregated AI predictions for all symbols.
 * Shows the latest prediction from Ollama analysis of multiple news articles.
 */
export default function MarketPredictions({ authFetch }) {
    const [prediction, setPrediction] = React.useState(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState(null);

    const load = React.useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // Fetch the latest aggregated prediction
            const res = await authFetch('/v1/insights?type=aggregated_prediction&limit=1');
            if (!res.ok) throw new Error('Failed to fetch: ' + res.status);
            const data = await res.json();

            if (data.rows && data.rows.length > 0) {
                setPrediction(data.rows[0]);
            } else {
                setPrediction(null);
            }
        } catch (e) {
            console.error('Failed loading predictions', e);
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [authFetch]);

    React.useEffect(() => {
        load();
        // Auto refresh every 60 seconds
        const interval = setInterval(load, 60000);
        return () => clearInterval(interval);
    }, [load]);

    const getDirectionStyle = (direction) => {
        switch (direction?.toUpperCase()) {
            case 'UP':
                return { color: '#10b981', bg: '#ecfdf5', icon: '🚀' };
            case 'DOWN':
                return { color: '#ef4444', bg: '#fef2f2', icon: '📉' };
            default:
                return { color: '#6b7280', bg: '#f9fafb', icon: '➖' };
        }
    };

    const getSentimentStyle = (sentiment) => {
        switch (sentiment?.toUpperCase()) {
            case 'BULLISH':
                return { color: '#10b981', label: 'Thị trường lạc quan' };
            case 'BEARISH':
                return { color: '#ef4444', label: 'Thị trường bi quan' };
            default:
                return { color: '#6b7280', label: 'Thị trường trung lập' };
        }
    };

    if (loading && !prediction) {
        return (
            <div className="predictions-container loading">
                <div className="loading-spinner">Đang tải dự đoán...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="predictions-container error">
                <p>Lỗi: {error}</p>
                <button onClick={load}>Thử lại</button>
            </div>
        );
    }

    if (!prediction) {
        return (
            <div className="predictions-container empty">
                <p>Chưa có dự đoán. Đang chờ AI phân tích tin tức...</p>
                <button onClick={load}>Refresh</button>
            </div>
        );
    }

    const payload = prediction.payload || {};
    const predictions = payload.predictions || [];
    const sentimentStyle = getSentimentStyle(payload.market_sentiment);

    return (
        <div className="predictions-container">
            {/* Header */}
            <div className="predictions-header">
                <h2>🤖 Dự đoán thị trường AI</h2>
                <div className="predictions-meta">
                    <span className="timestamp">
                        {new Date(prediction.time).toLocaleString('vi-VN')}
                    </span>
                    <span className="news-count">
                        Phân tích {payload.news_count || payload.analyzed_articles || 0} tin tức
                    </span>
                    <button onClick={load} disabled={loading}>
                        {loading ? '...' : '🔄 Refresh'}
                    </button>
                </div>
            </div>

            {/* Market Sentiment */}
            <div className="market-sentiment" style={{ borderLeftColor: sentimentStyle.color }}>
                <div className="sentiment-label" style={{ color: sentimentStyle.color }}>
                    {payload.market_sentiment || 'NEUTRAL'}
                </div>
                <div className="sentiment-desc">{sentimentStyle.label}</div>
            </div>

            {/* Analysis Summary */}
            {payload.analysis_summary && (
                <div className="analysis-summary">
                    <strong>Tóm tắt:</strong> {payload.analysis_summary}
                </div>
            )}

            {/* Predictions Grid */}
            <div className="predictions-grid">
                {predictions.map((pred, idx) => {
                    const style = getDirectionStyle(pred.direction);
                    return (
                        <div
                            key={idx}
                            className="prediction-card"
                            style={{ backgroundColor: style.bg, borderColor: style.color }}
                        >
                            <div className="symbol">{pred.symbol}</div>
                            <div className="direction" style={{ color: style.color }}>
                                {style.icon} {pred.direction}
                            </div>
                            <div className="change" style={{ color: style.color }}>
                                {pred.change_percent > 0 ? '+' : ''}{pred.change_percent?.toFixed(1)}%
                            </div>
                            <div className="confidence">
                                Độ tin cậy: {(pred.confidence * 100)?.toFixed(0)}%
                            </div>
                            {pred.reason && (
                                <div className="reason">{pred.reason}</div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Key Factors */}
            {payload.key_factors && payload.key_factors.length > 0 && (
                <div className="key-factors">
                    <strong>Yếu tố chính:</strong>
                    <ul>
                        {payload.key_factors.map((factor, idx) => (
                            <li key={idx}>{factor}</li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Risks */}
            {payload.risks && payload.risks.length > 0 && (
                <div className="risks">
                    <strong>⚠️ Rủi ro:</strong>
                    <ul>
                        {payload.risks.map((risk, idx) => (
                            <li key={idx}>{risk}</li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Model Info */}
            <div className="model-info">
                Model: {payload.model || 'Ollama'} |
                Symbols: {payload.symbols_analyzed?.join(', ') || 'N/A'}
            </div>

            <style>{`
        .predictions-container {
          background: #ffffff;
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 20px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        .predictions-container.loading,
        .predictions-container.empty,
        .predictions-container.error {
          text-align: center;
          padding: 40px;
          color: #666;
        }
        
        .predictions-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          flex-wrap: wrap;
          gap: 12px;
        }
        
        .predictions-header h2 {
          margin: 0;
          font-size: 1.25rem;
        }
        
        .predictions-meta {
          display: flex;
          gap: 12px;
          align-items: center;
          font-size: 0.85rem;
          color: #666;
        }
        
        .predictions-meta button {
          padding: 6px 12px;
          border: 1px solid #ddd;
          border-radius: 6px;
          background: #f5f5f5;
          cursor: pointer;
        }
        
        .market-sentiment {
          padding: 12px 16px;
          border-left: 4px solid;
          background: #f9fafb;
          margin-bottom: 16px;
          border-radius: 0 8px 8px 0;
        }
        
        .sentiment-label {
          font-size: 1.2rem;
          font-weight: bold;
        }
        
        .sentiment-desc {
          font-size: 0.9rem;
          color: #666;
        }
        
        .analysis-summary {
          padding: 12px;
          background: #f0f9ff;
          border-radius: 8px;
          margin-bottom: 16px;
          line-height: 1.5;
        }
        
        .predictions-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 12px;
          margin-bottom: 16px;
        }
        
        .prediction-card {
          padding: 16px;
          border-radius: 10px;
          border: 2px solid;
          text-align: center;
        }
        
        .prediction-card .symbol {
          font-size: 1.1rem;
          font-weight: bold;
          color: #333;
          margin-bottom: 8px;
        }
        
        .prediction-card .direction {
          font-size: 1.3rem;
          font-weight: bold;
          margin-bottom: 4px;
        }
        
        .prediction-card .change {
          font-size: 1.1rem;
          font-weight: 600;
          margin-bottom: 8px;
        }
        
        .prediction-card .confidence {
          font-size: 0.8rem;
          color: #666;
          margin-bottom: 8px;
        }
        
        .prediction-card .reason {
          font-size: 0.75rem;
          color: #555;
          line-height: 1.4;
        }
        
        .key-factors, .risks {
          margin-bottom: 12px;
        }
        
        .key-factors ul, .risks ul {
          margin: 8px 0 0 20px;
          padding: 0;
        }
        
        .key-factors li, .risks li {
          margin-bottom: 4px;
          font-size: 0.9rem;
        }
        
        .risks {
          color: #b45309;
          background: #fffbeb;
          padding: 12px;
          border-radius: 8px;
        }
        
        .model-info {
          font-size: 0.75rem;
          color: #999;
          text-align: right;
          margin-top: 12px;
        }
      `}</style>
        </div>
    );
}

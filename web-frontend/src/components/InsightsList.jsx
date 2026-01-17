import React, { useEffect, useState } from 'react';
import useStore from '../store';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Zap, AlertTriangle } from 'lucide-react';

export default function InsightsList() {
    const { authFetch, symbol } = useStore();
    const [aggregatedPrediction, setAggregatedPrediction] = useState(null);
    const [recentInsights, setRecentInsights] = useState([]);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('prediction'); // 'prediction' or 'history'

    useEffect(() => {
        loadData();
        // Auto refresh every 30 seconds
        const interval = setInterval(loadData, 30000);
        return () => clearInterval(interval);
    }, [symbol]);

    const loadData = async () => {
        setLoading(true);
        try {
            // Fetch aggregated prediction (latest)
            const predRes = await authFetch('/v1/insights?type=aggregated_prediction&limit=1');
            if (predRes.ok) {
                const predData = await predRes.json();
                if (predData.rows && predData.rows.length > 0) {
                    setAggregatedPrediction(predData.rows[0]);
                }
            }

            // Fetch recent causal events for history
            const histRes = await authFetch('/v1/insights?type=causal_event&limit=10');
            if (histRes.ok) {
                const histData = await histRes.json();
                setRecentInsights(histData.rows || []);
            }
        } catch (e) {
            console.error('Failed to load insights', e);
        } finally {
            setLoading(false);
        }
    };

    const getDirectionStyle = (direction) => {
        switch (direction?.toUpperCase()) {
            case 'UP':
                return { color: 'var(--accent-green)', icon: <TrendingUp size={14} />, label: 'TĂNG' };
            case 'DOWN':
                return { color: 'var(--accent-red)', icon: <TrendingDown size={14} />, label: 'GIẢM' };
            default:
                return { color: '#777', icon: <Minus size={14} />, label: 'ĐI NGANG' };
        }
    };

    const getSentimentBadge = (sentiment) => {
        switch (sentiment?.toUpperCase()) {
            case 'BULLISH':
                return <span className="sentiment-badge bullish">🚀 Lạc quan</span>;
            case 'BEARISH':
                return <span className="sentiment-badge bearish">📉 Bi quan</span>;
            default:
                return <span className="sentiment-badge neutral">➖ Trung lập</span>;
        }
    };

    // Render aggregated prediction
    const renderAggregatedPrediction = () => {
        if (!aggregatedPrediction) {
            return (
                <div className="no-prediction">
                    <Zap size={24} style={{ opacity: 0.5 }} />
                    <p>Đang chờ AI phân tích tin tức...</p>
                    <small>Dự đoán sẽ được tạo khi có đủ tin mới</small>
                </div>
            );
        }

        const payload = aggregatedPrediction.payload || {};
        const predictions = payload.predictions || [];
        const currentSymbolPred = predictions.find(p => p.symbol === symbol);

        return (
            <div className="aggregated-prediction">
                {/* Market Overview */}
                <div className="market-overview">
                    {getSentimentBadge(payload.market_sentiment)}
                    <span className="news-count">
                        {payload.news_count || payload.analyzed_articles || 0} tin tức
                    </span>
                </div>

                {/* Summary */}
                {payload.analysis_summary && (
                    <div className="analysis-summary">
                        {payload.analysis_summary}
                    </div>
                )}

                {/* Current Symbol Prediction (highlighted) */}
                {currentSymbolPred && (
                    <div className="current-symbol-pred">
                        <div className="pred-header">Dự đoán cho {symbol}</div>
                        <div className="pred-main" style={{ color: getDirectionStyle(currentSymbolPred.direction).color }}>
                            {getDirectionStyle(currentSymbolPred.direction).icon}
                            <span className="direction">{getDirectionStyle(currentSymbolPred.direction).label}</span>
                            <span className="change">
                                {currentSymbolPred.change_percent > 0 ? '+' : ''}{currentSymbolPred.change_percent?.toFixed(1)}%
                            </span>
                        </div>
                        {currentSymbolPred.reason && (
                            <div className="pred-reason">{currentSymbolPred.reason}</div>
                        )}
                        <div className="pred-confidence">
                            Độ tin cậy: {(currentSymbolPred.confidence * 100)?.toFixed(0)}%
                        </div>
                    </div>
                )}

                {/* All Predictions Grid */}
                <div className="predictions-mini-grid">
                    {predictions.map((pred, idx) => {
                        const style = getDirectionStyle(pred.direction);
                        const isActive = pred.symbol === symbol;
                        return (
                            <div
                                key={idx}
                                className={`pred-mini-card ${isActive ? 'active' : ''}`}
                                style={{ borderColor: style.color }}
                            >
                                <div className="symbol">{pred.symbol?.replace('USDT', '')}</div>
                                <div className="direction" style={{ color: style.color }}>
                                    {style.icon}
                                    <span>{pred.change_percent > 0 ? '+' : ''}{pred.change_percent?.toFixed(1)}%</span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Key Factors */}
                {payload.key_factors && payload.key_factors.length > 0 && (
                    <div className="key-factors">
                        <strong>Yếu tố chính:</strong>
                        {payload.key_factors.map((f, i) => <span key={i} className="factor-tag">{f}</span>)}
                    </div>
                )}

                {/* Risks */}
                {payload.risks && payload.risks.length > 0 && (
                    <div className="risks-section">
                        <AlertTriangle size={12} /> Rủi ro: {payload.risks.join(', ')}
                    </div>
                )}

                {/* Timestamp */}
                <div className="pred-timestamp">
                    Cập nhật: {new Date(aggregatedPrediction.time).toLocaleString('vi-VN')}
                </div>
            </div>
        );
    };

    return (
        <div className="insights-list">
            {/* Header with tabs */}
            <div className="insights-header">
                <div className="tabs">
                    <button
                        className={activeTab === 'prediction' ? 'active' : ''}
                        onClick={() => setActiveTab('prediction')}
                    >
                        🤖 Dự đoán AI
                    </button>
                    <button
                        className={activeTab === 'history' ? 'active' : ''}
                        onClick={() => setActiveTab('history')}
                    >
                        📋 Lịch sử
                    </button>
                </div>
                <button className="refresh-btn" onClick={loadData} disabled={loading}>
                    <RefreshCw size={12} className={loading ? 'spinning' : ''} />
                </button>
            </div>

            {/* Content */}
            <div className="insights-content">
                {activeTab === 'prediction' && renderAggregatedPrediction()}

                {activeTab === 'history' && (
                    <div className="history-list">
                        {recentInsights.length === 0 ? (
                            <div className="no-history">Chưa có lịch sử phân tích</div>
                        ) : (
                            recentInsights.map((item, idx) => {
                                const p = item.payload || {};
                                const title = p.title || 'Insight';
                                return (
                                    <div key={idx} className="history-item">
                                        <div className="history-time">
                                            {new Date(item.time).toLocaleTimeString('vi-VN')}
                                        </div>
                                        <div className="history-title">{title.substring(0, 50)}...</div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}
            </div>

            <style>{`
                .insights-list {
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                }
                
                .insights-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 8px;
                    border-bottom: 1px solid rgba(255,255,255,0.1);
                }
                
                .insights-header .tabs {
                    display: flex;
                    gap: 4px;
                }
                
                .insights-header .tabs button {
                    background: none;
                    border: none;
                    color: #888;
                    font-size: 11px;
                    padding: 6px 10px;
                    cursor: pointer;
                    border-radius: 4px;
                }
                
                .insights-header .tabs button.active {
                    background: rgba(255,255,255,0.1);
                    color: var(--accent-yellow);
                }
                
                .refresh-btn {
                    background: none;
                    border: none;
                    color: #666;
                    cursor: pointer;
                    padding: 4px;
                }
                
                .refresh-btn .spinning {
                    animation: spin 1s linear infinite;
                }
                
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                
                .insights-content {
                    flex: 1;
                    overflow-y: auto;
                    padding: 8px;
                }
                
                .no-prediction {
                    text-align: center;
                    padding: 20px;
                    color: #666;
                }
                
                .no-prediction p {
                    margin: 8px 0 4px;
                    font-size: 13px;
                }
                
                .no-prediction small {
                    font-size: 11px;
                    color: #555;
                }
                
                .aggregated-prediction {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                
                .market-overview {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                
                .sentiment-badge {
                    font-size: 11px;
                    padding: 4px 8px;
                    border-radius: 4px;
                }
                
                .sentiment-badge.bullish {
                    background: rgba(16, 185, 129, 0.2);
                    color: var(--accent-green);
                }
                
                .sentiment-badge.bearish {
                    background: rgba(239, 68, 68, 0.2);
                    color: var(--accent-red);
                }
                
                .sentiment-badge.neutral {
                    background: rgba(255,255,255,0.1);
                    color: #888;
                }
                
                .news-count {
                    font-size: 10px;
                    color: #666;
                }
                
                .analysis-summary {
                    font-size: 12px;
                    line-height: 1.5;
                    color: #bbb;
                    padding: 8px;
                    background: rgba(255,255,255,0.05);
                    border-radius: 6px;
                }
                
                .current-symbol-pred {
                    background: rgba(255,255,255,0.05);
                    border-radius: 8px;
                    padding: 12px;
                    border-left: 3px solid var(--accent-yellow);
                }
                
                .current-symbol-pred .pred-header {
                    font-size: 10px;
                    color: var(--accent-yellow);
                    margin-bottom: 8px;
                }
                
                .current-symbol-pred .pred-main {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 16px;
                    font-weight: bold;
                }
                
                .current-symbol-pred .pred-reason {
                    font-size: 11px;
                    color: #999;
                    margin-top: 8px;
                    line-height: 1.4;
                }
                
                .current-symbol-pred .pred-confidence {
                    font-size: 10px;
                    color: #666;
                    margin-top: 8px;
                }
                
                .predictions-mini-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 6px;
                }
                
                .pred-mini-card {
                    background: rgba(255,255,255,0.03);
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 6px;
                    padding: 8px;
                    text-align: center;
                }
                
                .pred-mini-card.active {
                    background: rgba(255,255,255,0.08);
                    border-width: 2px;
                }
                
                .pred-mini-card .symbol {
                    font-size: 10px;
                    color: #888;
                    margin-bottom: 4px;
                }
                
                .pred-mini-card .direction {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 4px;
                    font-size: 11px;
                    font-weight: bold;
                }
                
                .key-factors {
                    font-size: 11px;
                    color: #888;
                }
                
                .factor-tag {
                    display: inline-block;
                    background: rgba(255,255,255,0.1);
                    padding: 2px 6px;
                    border-radius: 4px;
                    margin: 2px 4px;
                    font-size: 10px;
                }
                
                .risks-section {
                    font-size: 10px;
                    color: #b45309;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                
                .pred-timestamp {
                    font-size: 9px;
                    color: #555;
                    text-align: right;
                }
                
                .history-list {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                
                .history-item {
                    padding: 8px;
                    background: rgba(255,255,255,0.03);
                    border-radius: 6px;
                }
                
                .history-time {
                    font-size: 10px;
                    color: #666;
                }
                
                .history-title {
                    font-size: 12px;
                    color: #aaa;
                    margin-top: 4px;
                }
                
                .no-history {
                    text-align: center;
                    color: #555;
                    padding: 20px;
                    font-size: 12px;
                }
            `}</style>
        </div>
    );
}

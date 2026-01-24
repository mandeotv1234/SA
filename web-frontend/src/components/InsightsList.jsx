import React, { useEffect, useState } from 'react';
import useStore from '../store';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Zap, AlertTriangle } from 'lucide-react';

export default function InsightsList() {
    const { authFetch, currentSymbol } = useStore();
    const [aggregatedPrediction, setAggregatedPrediction] = useState(null);
    const [recentInsights, setRecentInsights] = useState([]);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('prediction'); // 'prediction' or 'history'

    useEffect(() => {
        loadData();
        // Auto refresh every 30 seconds
        const interval = setInterval(loadData, 30000);
        return () => clearInterval(interval);
    }, [currentSymbol]);

    const loadData = async () => {
        setLoading(true);
        try {
            // Fetch aggregated prediction (latest)
            const predRes = await authFetch('/v1/insights?type=aggregated_prediction&limit=1');
            if (predRes.ok) {
                const predData = await predRes.json();
                console.log('[InsightsList] Prediction data:', predData);
                if (predData.rows && predData.rows.length > 0) {
                    console.log('[InsightsList] Setting prediction:', predData.rows[0]);
                    setAggregatedPrediction(predData.rows[0]);
                } else {
                    console.warn('[InsightsList] No prediction rows found');
                }
            } else {
                console.error('[InsightsList] Failed to fetch predictions:', predRes.status);
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
        const sentimentStr = String(sentiment || '').toUpperCase();
        switch (sentimentStr) {
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
        console.log('[InsightsList] Rendering prediction, data:', aggregatedPrediction);

        if (!aggregatedPrediction) {
            console.log('[InsightsList] No aggregated prediction data');
            return (
                <div className="no-prediction">
                    <Zap size={24} style={{ opacity: 0.5 }} />
                    <p>Đang chờ AI phân tích tin tức...</p>
                    <small>Dự đoán sẽ được tạo khi có đủ tin mới</small>
                </div>
            );
        }

        const payload = aggregatedPrediction.payload || {};
        const meta = payload.meta || {};
        const predictions = payload.predictions || [];

        console.log('[InsightsList] Payload:', payload);
        console.log('[InsightsList] Meta:', meta);
        console.log('[InsightsList] Predictions:', predictions);
        console.log('[InsightsList] Current symbol:', currentSymbol);

        const currentSymbolPred = predictions.find(p => p.symbol === currentSymbol);
        console.log('[InsightsList] Current symbol prediction:', currentSymbolPred);

        if (!currentSymbolPred) {
            console.warn('[InsightsList] No prediction found for symbol:', currentSymbol);
            return (
                <div className="no-prediction">
                    <AlertTriangle size={20} style={{ opacity: 0.5 }} />
                    <p>Chưa có dự đoán cho {currentSymbol}</p>
                    <small>Hệ thống đang phân tích...</small>
                </div>
            );
        }

        const forecast1h = currentSymbolPred.forecast?.next_1h || {};
        const forecast24h = currentSymbolPred.forecast?.next_24h || {};
        const causal = currentSymbolPred.causal_analysis || {};
        const sources = currentSymbolPred.sources || [];

        console.log('[InsightsList] Forecast 1h:', forecast1h);
        console.log('[InsightsList] Forecast 24h:', forecast24h);
        console.log('[InsightsList] Causal:', causal);
        console.log('[InsightsList] Sources:', sources);

        return (
            <div className="aggregated-prediction">
                {/* Market Overview */}
                <div className="market-overview">
                    {getSentimentBadge(meta.market_sentiment_label)}
                    <span className="news-count">
                        {meta.analyzed_articles || 0} tin tức
                    </span>
                </div>

                {/* Current Symbol Prediction - 1H Forecast */}
                <div className="current-symbol-pred">
                    <div className="pred-header">Dự đoán {currentSymbol} - 1 Giờ Tới</div>
                    <div className="pred-main" style={{ color: getDirectionStyle(forecast1h.direction).color }}>
                        {getDirectionStyle(forecast1h.direction).icon}
                        <span className="direction">{getDirectionStyle(forecast1h.direction).label}</span>
                        <span className="price-target">
                            → ${forecast1h.expected_price?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                    </div>
                    <div className="pred-details">
                        <span className="detail-item">
                            <strong>Giá hiện tại:</strong> ${currentSymbolPred.current_price?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className="detail-item">
                            <strong>Độ tin cậy:</strong> {forecast1h.confidence?.toFixed(1)}%
                        </span>
                        <span className="detail-item">
                            <strong>Biến động:</strong> {forecast1h.volatility}
                        </span>
                    </div>
                </div>

                {/* 24H Forecast */}
                <div className="forecast-24h">
                    <div className="forecast-header">📅 Dự báo 24 Giờ</div>
                    <div className="forecast-content">
                        <div className="forecast-direction" style={{ color: getDirectionStyle(forecast24h.direction).color }}>
                            {getDirectionStyle(forecast24h.direction).icon}
                            <span>{getDirectionStyle(forecast24h.direction).label}</span>
                        </div>
                        {forecast24h.expected_range && (
                            <div className="price-range">
                                <span className="range-label">Khoảng giá:</span>
                                <span className="range-values">
                                    ${forecast24h.expected_range.low?.toLocaleString()} - ${forecast24h.expected_range.high?.toLocaleString()}
                                </span>
                            </div>
                        )}
                        <div className="forecast-confidence">
                            Độ tin cậy: {forecast24h.confidence?.toFixed(1)}%
                        </div>
                    </div>
                </div>

                {/* Causal Analysis */}
                {causal.explanation_vi && (
                    <div className="causal-analysis">
                        <div className="causal-header">
                            <Zap size={12} />
                            Phân Tích Nhân Quả
                        </div>
                        <div className="causal-content">
                            <div className="causal-driver">
                                <strong>Động lực chính:</strong> {causal.primary_driver?.replace('_', ' ')}
                            </div>
                            {causal.key_event && (
                                <div className="causal-event">
                                    <strong>Sự kiện:</strong> {causal.key_event}
                                </div>
                            )}
                            <div className="causal-explanation">
                                {causal.explanation_vi}
                            </div>
                            {causal.sentiment_impact && (
                                <div className="sentiment-impact">
                                    <span>Sentiment: {causal.sentiment_impact.news_sentiment?.toFixed(2)}</span>
                                    <span>Volume: {causal.sentiment_impact.social_volume}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* News Sources */}
                {sources.length > 0 && (
                    <div className="news-sources">
                        <div className="sources-header">📰 Tin Tức Ảnh Hưởng</div>
                        {sources.map((source, idx) => (
                            <div key={idx} className="source-item">
                                <div className="source-title">{source.title}</div>
                                <div className="source-meta">
                                    <span>{source.source}</span>
                                    <span className="impact-score">Impact: {source.impact_score}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Other Symbols - Compact Grid */}
                <div className="other-symbols-section">
                    <div className="section-header">Các Cặp Khác</div>
                    <div className="predictions-mini-grid">
                        {predictions.filter(p => p.symbol !== currentSymbol).map((pred, idx) => {
                            const f1h = pred.forecast?.next_1h || {};
                            const style = getDirectionStyle(f1h.direction);
                            return (
                                <div
                                    key={idx}
                                    className="pred-mini-card"
                                    style={{ borderColor: style.color }}
                                >
                                    <div className="symbol">{pred.symbol?.replace('USDT', '')}</div>
                                    <div className="direction" style={{ color: style.color }}>
                                        {style.icon}
                                        <span>{f1h.confidence?.toFixed(0)}%</span>
                                    </div>
                                    <div className="mini-price">
                                        ${pred.current_price?.toFixed(2)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

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
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                
                .current-symbol-pred .pred-main {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 16px;
                    font-weight: bold;
                    margin-bottom: 8px;
                }

                .current-symbol-pred .price-target {
                    font-size: 14px;
                    margin-left: auto;
                }

                .pred-details {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 12px;
                    font-size: 11px;
                    color: #999;
                    margin-top: 8px;
                }

                .detail-item {
                    display: flex;
                    gap: 4px;
                }

                .detail-item strong {
                    color: #bbb;
                }

                .forecast-24h {
                    background: rgba(255,255,255,0.03);
                    border-radius: 8px;
                    padding: 10px;
                    border: 1px solid rgba(255,255,255,0.08);
                }

                .forecast-header {
                    font-size: 11px;
                    color: #aaa;
                    margin-bottom: 8px;
                    font-weight: 600;
                }

                .forecast-content {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }

                .forecast-direction {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 14px;
                    font-weight: bold;
                }

                .price-range {
                    font-size: 11px;
                    color: #999;
                    display: flex;
                    gap: 8px;
                }

                .range-label {
                    color: #777;
                }

                .range-values {
                    color: #bbb;
                    font-weight: 500;
                }

                .forecast-confidence {
                    font-size: 10px;
                    color: #666;
                }

                .causal-analysis {
                    background: rgba(255,255,255,0.03);
                    border-radius: 8px;
                    padding: 10px;
                    border-left: 3px solid var(--accent-blue);
                }

                .causal-header {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 11px;
                    color: var(--accent-blue);
                    margin-bottom: 8px;
                    font-weight: 600;
                }

                .causal-content {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    font-size: 11px;
                }

                .causal-driver, .causal-event {
                    color: #999;
                }

                .causal-driver strong, .causal-event strong {
                    color: #bbb;
                }

                .causal-explanation {
                    color: #ccc;
                    line-height: 1.5;
                    margin-top: 4px;
                    font-size: 12px;
                }

                .sentiment-impact {
                    display: flex;
                    gap: 12px;
                    font-size: 10px;
                    color: #777;
                    margin-top: 4px;
                }

                .news-sources {
                    background: rgba(255,255,255,0.03);
                    border-radius: 8px;
                    padding: 10px;
                }

                .sources-header {
                    font-size: 11px;
                    color: #aaa;
                    margin-bottom: 8px;
                    font-weight: 600;
                }

                .source-item {
                    padding: 6px 0;
                    border-bottom: 1px solid rgba(255,255,255,0.05);
                }

                .source-item:last-child {
                    border-bottom: none;
                }

                .source-title {
                    font-size: 11px;
                    color: #bbb;
                    margin-bottom: 4px;
                }

                .source-meta {
                    display: flex;
                    justify-content: space-between;
                    font-size: 10px;
                    color: #777;
                }

                .impact-score {
                    color: var(--accent-yellow);
                }

                .other-symbols-section {
                    margin-top: 8px;
                }

                .section-header {
                    font-size: 10px;
                    color: #777;
                    margin-bottom: 8px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
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
                    margin-bottom: 4px;
                }

                .pred-mini-card .mini-price {
                    font-size: 10px;
                    color: #999;
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

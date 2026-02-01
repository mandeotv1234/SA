import React, { useEffect, useState } from 'react';
import useStore from '../store';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Zap, AlertTriangle, Bell, BellOff } from 'lucide-react';

export default function InsightsList() {
    const { authFetch, currentSymbol, user } = useStore();
    const [predNotifEnabled, setPredNotifEnabled] = useState(false);
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

    // Load notification settings from auth-service
    useEffect(() => {
        if (!user?.id) return;
        const fetchSettings = async () => {
            try {
                const res = await authFetch('/auth/notifications/settings');
                if (res.ok) {
                    const settings = await res.json();
                    // settings = {prediction_symbols: [...], investment_enabled: true/false}
                    setPredNotifEnabled(settings.prediction_symbols?.includes(currentSymbol) || false);
                }
            } catch (e) {
                console.warn('[NOTIF] Failed to load settings:', e);
            }
        };
        fetchSettings();
    }, [user?.id, currentSymbol]);

    const handleToggleNotif = async () => {
        if (!user?.id) {
            alert('Vui lòng đăng nhập để sử dụng tính năng này.');
            return;
        }

        const newState = !predNotifEnabled;
        setPredNotifEnabled(newState);

        try {
            const res = await authFetch('/auth/notifications/settings', {
                method: 'POST',
                body: JSON.stringify({
                    type: 'PREDICTION',
                    symbol: currentSymbol,
                    enabled: newState
                })
            });

            if (!res.ok) {
                throw new Error('Failed to update settings');
            }

            console.log(`[NOTIF] ${newState ? 'Enabled' : 'Disabled'} notifications for ${currentSymbol}`);
        } catch (e) {
            console.error('[NOTIF] Error:', e);
            setPredNotifEnabled(!newState); // Revert on error
            alert('Không thể cập nhật cài đặt. Vui lòng thử lại.');
        }
    };

    const loadData = async () => {
        setLoading(true);
        try {
            // Fetch latest prediction for current symbol
            const predRes = await authFetch(`/v1/insights/latest/${currentSymbol}`);
            if (predRes.ok) {
                const predData = await predRes.json();
                console.log('[InsightsList] Prediction data for', currentSymbol, ':', predData);

                // Transform to match expected format
                const transformedData = {
                    time: predData.prediction_time,
                    payload: predData.data
                };
                setAggregatedPrediction(transformedData);
            } else if (predRes.status === 404) {
                console.warn('[InsightsList] No prediction found for', currentSymbol);
                setAggregatedPrediction(null);
            } else {
                console.error('[InsightsList] Failed to fetch prediction:', predRes.status);
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

        // Since we're fetching per-symbol, predictions array should have only 1 item
        const currentSymbolPred = predictions[0] || null;
        console.log('[InsightsList] Current symbol prediction:', currentSymbolPred);

        if (!currentSymbolPred) {
            console.warn('[InsightsList] No prediction data in payload');
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
                    <div className="overview-left">
                        {getSentimentBadge(meta.market_sentiment_label)}
                        <span className="news-count">
                            {meta.analyzed_articles || 0} tin tức
                        </span>
                    </div>
                    <div className="overview-time">
                        {new Date(aggregatedPrediction.time).toLocaleTimeString('vi-VN', {
                            hour: '2-digit',
                            minute: '2-digit'
                        })}
                    </div>
                </div>

                {/* Current Symbol Prediction - 1H Forecast */}
                <div className="current-symbol-pred">
                    <div className="pred-header">Dự đoán {currentSymbol} - 1 Giờ Tới</div>
                    {(() => {
                        const currentPrice = currentSymbolPred.current_price || 0;
                        const expectedPrice = forecast1h.expected_price || 0;
                        const priceChange = expectedPrice - currentPrice;
                        const changePercent = currentPrice > 0 ? (priceChange / currentPrice) * 100 : 0;

                        // Determine actual direction based on price change
                        let actualDirection = 'SIDEWAYS';
                        if (Math.abs(changePercent) < 0.01) {
                            actualDirection = 'SIDEWAYS';
                        } else if (changePercent > 0) {
                            actualDirection = 'UP';
                        } else {
                            actualDirection = 'DOWN';
                        }

                        const style = getDirectionStyle(actualDirection);

                        return (
                            <>
                                <div className="pred-main" style={{ color: style.color }}>
                                    {style.icon}
                                    <span className="direction">{style.label}</span>
                                    <span className="price-change">
                                        {changePercent > 0 ? '+' : ''}{changePercent.toFixed(2)}%
                                    </span>
                                    <span className="price-target">
                                        → ${expectedPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                </div>
                                <div className="pred-details">
                                    <span className="detail-item">
                                        <strong>Giá ở lần phân tích:</strong> ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                    <span className="detail-item">
                                        <strong>Độ tin cậy:</strong> {forecast1h.confidence?.toFixed(1)}%
                                    </span>
                                    <span className="detail-item">
                                        <strong>Biến động:</strong> {forecast1h.volatility}
                                    </span>
                                </div>
                            </>
                        );
                    })()}
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
                                    <span>Chỉ số cảm xúc: {causal.sentiment_impact.news_sentiment?.toFixed(2)}</span>
                                    <span>Khối lượng: {causal.sentiment_impact.social_volume}</span>
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
                                    <span className="impact-score">Tác động: {source.impact_score}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Timestamp */}
                <div className="pred-timestamp">
                    <div className="timestamp-label">⏱️ Thời gian phân tích:</div>
                    <div className="timestamp-value">
                        {new Date(aggregatedPrediction.time).toLocaleString('vi-VN', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                        })}
                    </div>
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
                <div style={{ display: 'flex', gap: '4px' }}>
                    <button className="refresh-btn" onClick={handleToggleNotif} title={`Nhận thông báo khi có dự đoán mới cho ${currentSymbol}`}>
                        {predNotifEnabled ? <Bell size={12} color="#3b82f6" fill="#3b82f6" /> : <BellOff size={12} />}
                    </button>
                    <button className="refresh-btn" onClick={loadData} disabled={loading}>
                        <RefreshCw size={12} className={loading ? 'spinning' : ''} />
                    </button>
                </div>
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
                    margin-bottom: 4px;
                }
                
                .overview-left {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                
                .overview-time {
                    font-size: 10px;
                    color: var(--accent-yellow);
                    font-weight: 600;
                    background: rgba(255, 193, 7, 0.1);
                    padding: 4px 8px;
                    border-radius: 4px;
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
                    flex-wrap: wrap;
                }
                
                .current-symbol-pred .price-change {
                    font-size: 15px;
                    font-weight: 700;
                    padding: 2px 6px;
                    border-radius: 4px;
                    background: rgba(255,255,255,0.1);
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
                    background: rgba(255,255,255,0.03);
                    border-radius: 6px;
                    padding: 8px 10px;
                    margin-top: 8px;
                    border-left: 2px solid var(--accent-yellow);
                }
                
                .pred-timestamp .timestamp-label {
                    font-size: 10px;
                    color: #888;
                    margin-bottom: 4px;
                }
                
                .pred-timestamp .timestamp-value {
                    font-size: 11px;
                    color: #bbb;
                    font-weight: 500;
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

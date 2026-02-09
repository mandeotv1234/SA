import React, { useEffect, useState } from 'react';
import useStore from '../store';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Zap, AlertTriangle, Bell, BellOff } from 'lucide-react';
import { InsightsSkeleton } from './LoadingSpinner';

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
        const meta = payload.meta || {};
        const predictions = payload.predictions || [];
        const currentSymbolPred = predictions[0] || null;

        if (!currentSymbolPred) {
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
        const newsImpact = currentSymbolPred.news_impact_analysis || {};
        const tech = currentSymbolPred.technical_indicators || {};

        // Sentiment Badge Helper
        const renderSentimentBadge = (label) => {
            const l = (label || '').toUpperCase();
            let className = 'neutral';
            let icon = '➖';
            if (l === 'BULLISH' || l === 'POSITIVE' || l === 'UP') { className = 'bullish'; icon = '🚀'; }
            else if (l === 'BEARISH' || l === 'NEGATIVE' || l === 'DOWN') { className = 'bearish'; icon = '📉'; }
            return <span className={`sentiment-badge ${className}`}>{icon} {label || 'NEUTRAL'}</span>;
        };

        return (
            <div className="aggregated-prediction">
                {/* Market Overview */}
                <div className="market-overview">
                    <div className="overview-left">
                        {renderSentimentBadge(meta.market_sentiment_label || newsImpact.overall_sentiment)}
                        <span className="news-count">
                            {meta.analyzed_articles || 0} tin tức • RSI: {tech.rsi?.toFixed(1)}
                        </span>
                    </div>
                    <div className="overview-time">
                        {new Date(aggregatedPrediction.time).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                </div>

                {/* 1H Forecast Block */}
                <div className="current-symbol-pred">
                    <div className="pred-header">Dự đoán {currentSymbol} - 1H</div>
                    {(() => {
                        const currentPrice = currentSymbolPred.current_price || 0;
                        const expectedPrice = forecast1h.expected_price || 0;
                        const priceChange = expectedPrice - currentPrice;
                        const changePercent = currentPrice > 0 ? (priceChange / currentPrice) * 100 : 0;

                        let actualDirection = 'SIDEWAYS';
                        if (changePercent > 0.05) actualDirection = 'UP';
                        else if (changePercent < -0.05) actualDirection = 'DOWN';

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
                                        <strong>Confidence:</strong> {forecast1h.confidence?.toFixed(1)}%
                                    </span>
                                    <span className="detail-item">
                                        <strong>Volatility:</strong> {forecast1h.volatility}
                                    </span>
                                </div>
                            </>
                        );
                    })()}
                </div>

                {/* 24H Forecast Block */}
                <div className="forecast-24h">
                    <div className="forecast-header">📅 Dự báo 24H (Swing)</div>
                    <div className="forecast-content">
                        {(() => {
                            const expectedPrice24h = forecast24h.expected_price || 0;
                            const range = forecast24h.expected_range || {};
                            const changePercent24h = forecast24h.price_change_percent || 0;
                            const style = getDirectionStyle(forecast24h.direction);

                            return (
                                <>
                                    <div className="forecast-direction" style={{ color: style.color }}>
                                        {style.icon}
                                        <span>{style.label}</span>
                                        <span className="price-change-24h">
                                            {changePercent24h > 0 ? '+' : ''}{changePercent24h.toFixed(2)}%
                                        </span>
                                    </div>
                                    <div className="price-target-24h">
                                        <span className="target-label">Mục tiêu:</span>
                                        <span className="target-value" style={{ color: style.color }}>
                                            ${expectedPrice24h.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                    {range.low && (
                                        <div className="price-range">
                                            <span className="range-label">Range:</span>
                                            <span className="range-values">
                                                ${range.low?.toLocaleString()} - ${range.high?.toLocaleString()}
                                            </span>
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                </div>

                {/* Causal Analysis - Deep Dive */}
                {causal && (
                    <div className="causal-analysis-section">
                        <div className="section-header">🔍 Phân Tích Nguyên Nhân</div>

                        {causal.key_event && (
                            <div className="causal-item key-event">
                                <div className="causal-label">📌 Sự kiện chính:</div>
                                <div className="causal-value">{causal.key_event?.replace(/^(Sự kiện\/pattern chính bằng tiếng Việt:|Sự kiện chính:)\s*/i, '').trim()}</div>
                            </div>
                        )}

                        {causal.causal_chain && (
                            <div className="causal-chain-block">


                            </div>
                        )}


                    </div>
                )}

                {/* Comprehensive Explanation */}
                {(currentSymbolPred.explanation || causal.explanation_vi) && (
                    <div className="explanation-section">
                        <div className="explanation-header">
                            <Zap size={14} /> Tổng Hợp AI
                        </div>
                        <div className="explanation-content">
                            {causal.explanation_vi || currentSymbolPred.explanation}
                        </div>
                    </div>
                )}

                {/* News Impact Analysis */}
                {newsImpact.top_articles?.length > 0 && (
                    <div className="news-impact-section">
                        {/* <div className="news-impact-header">
                            📰 Phân tích tin tức ({newsImpact.combined_impact || newsImpact.overall_sentiment})
                        </div> */}
                        {newsImpact.top_articles.map((article, idx) => {
                            const hasLink = !!(article.url || article.link);
                            const articleUrl = article.url || article.link;
                            const llm = article.llm_analysis || {};

                            return (
                                <div
                                    key={idx}
                                    className={`news-impact-item ${hasLink ? 'clickable' : ''}`}
                                    onClick={() => hasLink && window.open(articleUrl, '_blank')}
                                    title={hasLink ? "Click để đọc bài báo gốc" : ""}
                                    style={{ cursor: hasLink ? 'pointer' : 'default' }}
                                >
                                    <div className="news-title-row">
                                        <div className="news-impact-title">
                                            {article.has_direct_mention && <span className="direct-badge">Direct</span>}
                                            {article.title}
                                            {hasLink && <span className="link-icon"> 🔗</span>}
                                        </div>
                                    </div>

                                    <div className="news-impact-meta">
                                        <span className="news-source">{article.source}</span>
                                        <span className="news-time">
                                            {article.published_at ? new Date(article.published_at).toLocaleString('vi-VN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                                        </span>
                                        <span className={`sentiment-badge ${article.sentiment_score > 0.1 ? 'positive' : article.sentiment_score < -0.1 ? 'negative' : 'neutral'}`}>
                                            Score: {article.sentiment_score}
                                        </span>
                                    </div>

                                    {/* Detailed LLM Analysis Grid */}
                                    {llm.is_relevant && (
                                        <div className="llm-analysis-grid">
                                            {llm.summary && (
                                                <div className="analysis-row summary">
                                                    <strong>Tóm tắt:</strong> {llm.summary}
                                                </div>
                                            )}

                                            <div className="analysis-metrics">
                                                <div className="metric">
                                                    <span className="label">Độ tin cậy:</span>
                                                    <span className="value">{llm.confidence}</span>
                                                </div>
                                                <div className="metric">
                                                    <span className="label">Tác động thời gian:</span>
                                                    <span className="value">{llm.time_effect}</span>
                                                </div>
                                                <div className="metric">
                                                    <span className="label">Dự báo:</span>
                                                    <span className="value highlight">{llm.predicted_impact}</span>
                                                </div>
                                            </div>


                                        </div>
                                    )}
                                </div>
                            );
                        })}
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
                    {/* <button
                        className={activeTab === 'history' ? 'active' : ''}
                        onClick={() => setActiveTab('history')}
                    >
                        📋 Lịch sử
                    </button> */}
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
                {activeTab === 'prediction' && (
                    loading ? <InsightsSkeleton /> : renderAggregatedPrediction()
                )}

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

                .price-change-24h {
                    font-size: 13px;
                    font-weight: 700;
                    padding: 2px 6px;
                    border-radius: 4px;
                    background: rgba(255,255,255,0.1);
                    margin-left: auto;
                }

                .price-target-24h {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    font-size: 12px;
                    margin: 6px 0;
                }

                .target-label {
                    color: #999;
                }

                .target-value {
                    font-size: 14px;
                    font-weight: 600;
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

                .actionable-advice {
                    background: rgba(59, 130, 246, 0.1);
                    border-left: 3px solid var(--accent-blue);
                    padding: 8px 10px;
                    margin-top: 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    color: #ccc;
                    line-height: 1.5;
                }

                .actionable-advice strong {
                    color: var(--accent-blue);
                    margin-right: 4px;
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

                /* NEW: Causal Reasoning 3-Layer Styles */
                .causal-reasoning-section {
                    background: linear-gradient(135deg, rgba(59, 130, 246, 0.05), rgba(139, 92, 246, 0.05));
                    border: 1px solid rgba(59, 130, 246, 0.2);
                    border-radius: 12px;
                    padding: 12px;
                    margin-top: 8px;
                }

                .causal-reasoning-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 13px;
                    font-weight: 700;
                    color: var(--accent-blue);
                    margin-bottom: 12px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid rgba(59, 130, 246, 0.2);
                }

                .reasoning-layer {
                    background: rgba(255, 255, 255, 0.03);
                    border-radius: 8px;
                    padding: 10px;
                    margin-bottom: 8px;
                    border-left: 3px solid #666;
                }

                .reasoning-layer.alignment-layer {
                    border-left-color: #10b981;
                }

                .reasoning-layer.impact-layer {
                    border-left-color: #f59e0b;
                }

                .reasoning-layer.divergence-layer {
                    border-left-color: #8b5cf6;
                }

                .reasoning-layer.divergence-layer.has-divergence {
                    border-left-color: #ef4444;
                    background: rgba(239, 68, 68, 0.05);
                }

                .layer-title {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 10px;
                    font-weight: 700;
                    color: #aaa;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    margin-bottom: 6px;
                }

                .layer-icon {
                    font-size: 12px;
                }

                .layer-content {
                    font-size: 11px;
                    color: #ccc;
                    line-height: 1.5;
                }

                .layer-summary {
                    color: #ddd;
                }

                .alignment-details {
                    display: flex;
                    gap: 12px;
                    margin-top: 6px;
                    font-size: 10px;
                    color: #888;
                }

                .alignment-details strong {
                    color: var(--accent-green);
                }

                .impact-mechanism {
                    margin-bottom: 6px;
                }

                .mechanism-type {
                    background: rgba(245, 158, 11, 0.2);
                    color: #f59e0b;
                    padding: 3px 8px;
                    border-radius: 4px;
                    font-size: 10px;
                    font-weight: 600;
                    text-transform: uppercase;
                }

                .trading-recommendation {
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 8px;
                    padding: 12px;
                    margin-top: 8px;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                }

                .trading-recommendation.buy {
                    background: rgba(16, 185, 129, 0.08);
                    border-color: rgba(16, 185, 129, 0.3);
                }

                .trading-recommendation.sell {
                    background: rgba(239, 68, 68, 0.08);
                    border-color: rgba(239, 68, 68, 0.3);
                }

                .trading-recommendation.wait {
                    background: rgba(245, 158, 11, 0.08);
                    border-color: rgba(245, 158, 11, 0.3);
                }

                .recommendation-action {
                    font-size: 14px;
                    font-weight: 700;
                    margin-bottom: 8px;
                    text-align: center;
                }

                .recommendation-detail {
                    display: flex;
                    justify-content: space-between;
                    font-size: 11px;
                    padding: 4px 0;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                }

                .recommendation-detail .label {
                    color: #888;
                }

                .recommendation-detail .value {
                    color: #ccc;
                    font-weight: 600;
                }

                .recommendation-detail .value.stop-loss {
                    color: var(--accent-red);
                }

                .recommendation-detail .value.take-profit {
                    color: var(--accent-green);
                }

                .recommendation-warning {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    margin-top: 8px;
                    padding: 8px;
                    background: rgba(245, 158, 11, 0.1);
                    border-radius: 4px;
                    color: #f59e0b;
                    font-size: 10px;
                    line-height: 1.4;
                }

                /* NEW: Explanation Section Styles */
                .explanation-section {
                    background: linear-gradient(135deg, rgba(59, 130, 246, 0.1), rgba(147, 51, 234, 0.1));
                    border-radius: 8px;
                    padding: 12px;
                    border: 1px solid rgba(59, 130, 246, 0.2);
                }

                .explanation-header {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 12px;
                    font-weight: 600;
                    color: #3b82f6;
                    margin-bottom: 10px;
                }

                .explanation-content {
                    font-size: 12px;
                    line-height: 1.6;
                    color: #e0e0e0;
                    text-align: justify;
                }

                /* NEW: News Impact Analysis Styles */
                .news-impact-section {
                    background: rgba(255, 255, 255, 0.03);
                    border-radius: 8px;
                    padding: 10px;
                    border: 1px solid rgba(255, 255, 255, 0.08);
                }

                .news-impact-header {
                    font-size: 11px;
                    font-weight: 600;
                    color: #aaa;
                    margin-bottom: 10px;
                    padding-bottom: 6px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                }

                .news-impact-item {
                    padding: 10px;
                    border-radius: 6px;
                    background: rgba(255, 255, 255, 0.02);
                    margin-bottom: 8px;
                    border-left: 3px solid rgba(59, 130, 246, 0.5);
                    transition: all 0.2s ease;
                }

                .news-impact-item.clickable {
                    cursor: pointer;
                }

                .news-impact-item.clickable:hover {
                    background: rgba(255, 255, 255, 0.05);
                    transform: translateX(2px);
                    border-left-color: var(--accent-blue);
                }

                .news-impact-item:last-child {
                    margin-bottom: 0;
                }

                .news-impact-title {
                    font-size: 11px;
                    font-weight: 600;
                    color: #ddd;
                    margin-bottom: 6px;
                    line-height: 1.4;
                }

                .direct-badge {
                    display: inline-block;
                    font-size: 9px;
                    padding: 2px 6px;
                    border-radius: 4px;
                    background: rgba(34, 197, 94, 0.2);
                    color: #22c55e;
                    margin-right: 6px;
                    font-weight: 700;
                }

                .news-impact-meta {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 8px;
                    flex-wrap: wrap;
                    gap: 4px;
                }
                
                .meta-left {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    color: #888;
                }

                .news-time {
                    font-size: 10px;
                    color: #666;
                }

                .news-source {
                    font-size: 10px;
                    color: #888;
                }

                .sentiment-badge {
                    font-size: 10px;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-weight: 600;
                }

                .sentiment-badge.positive {
                    background: rgba(34, 197, 94, 0.15);
                    color: #22c55e;
                }

                .sentiment-badge.negative {
                    background: rgba(239, 68, 68, 0.15);
                    color: #ef4444;
                }

                .sentiment-badge.neutral {
                    background: rgba(156, 163, 175, 0.15);
                    color: #9ca3af;
                }

                /* Enhanced News Impact + Causal Analysis CSS */
                .causal-analysis-section {
                    background: linear-gradient(135deg, rgba(8, 145, 178, 0.05), rgba(37, 99, 235, 0.05));
                    border-radius: 8px;
                    padding: 10px;
                    border: 1px solid rgba(8, 145, 178, 0.2);
                    margin-bottom: 8px;
                }

                .causal-item {
                    margin-bottom: 8px;
                }

                .causal-label {
                    font-size: 10px;
                    color: #888;
                    text-transform: uppercase;
                    margin-bottom: 2px;
                }

                .causal-value {
                    font-size: 12px;
                    color: #e0e0e0;
                    line-height: 1.4;
                }

                .causal-chain-block {
                    margin-top: 10px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 4px;
                }

                .chain-step {
                    background: rgba(255, 255, 255, 0.03);
                    border-radius: 6px;
                    padding: 8px;
                    width: 100%;
                    border-left: 3px solid #666;
                }

                .chain-step p {
                    margin: 4px 0 0;
                    font-size: 11px;
                    color: #ccc;
                    line-height: 1.3;
                }

                .step-badge {
                    font-size: 9px;
                    text-transform: uppercase;
                    padding: 2px 5px;
                    border-radius: 3px;
                    font-weight: 700;
                }

                .step-badge.cause { background: rgba(59, 130, 246, 0.2); color: #60a5fa; border-left-color: #3b82f6; }
                .step-badge.mechanism { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border-left-color: #f59e0b; }
                .step-badge.effect { background: rgba(16, 185, 129, 0.2); color: #34d399; border-left-color: #10b981; }

                .chain-arrow {
                    font-size: 10px;
                    color: #666;
                    opacity: 0.5;
                }

                .actionable-advice-box {
                    background: rgba(34, 197, 94, 0.05);
                    border: 1px solid rgba(34, 197, 94, 0.2);
                    border-radius: 6px;
                    padding: 8px;
                    margin-top: 10px;
                }

                .advice-title {
                    font-size: 10px;
                    font-weight: 700;
                    color: #4ade80;
                    text-transform: uppercase;
                    margin-bottom: 4px;
                }

                .actionable-advice-box p {
                    font-size: 11px;
                    color: #d1fae5;
                    margin: 0;
                }

                .news-impact-analysis {
                    background: rgba(0, 0, 0, 0.2);
                    border-radius: 4px;
                    padding: 8px;
                    margin-top: 6px;
                }

                .llm-analysis-grid {
                    display: grid;
                    gap: 6px;
                }

                .analysis-row {
                    font-size: 10px;
                    color: #ccc;
                    line-height: 1.4;
                }

                .analysis-row strong {
                    color: #999;
                    margin-right: 4px;
                }

                .analysis-metrics {
                    display: flex;
                    gap: 8px;
                    background: rgba(255, 255, 255, 0.03);
                    padding: 4px 6px;
                    border-radius: 4px;
                }

                .metric {
                    display: flex;
                    flex-direction: column;
                }

                .metric .label {
                    font-size: 8px;
                    color: #777;
                }

                .metric .value {
                    font-size: 10px;
                    font-weight: 600;
                    color: #ddd;
                }

                .metric .value.highlight {
                    color: var(--accent-yellow);
                }

                .link-icon {
                    font-size: 10px;
                    margin-left: 4px;
                    opacity: 0.7;
                }

            `}</style>
        </div>
    );
}

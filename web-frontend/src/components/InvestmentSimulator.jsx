import React, { useState, useEffect, useRef } from 'react';
import useStore from '../store';
import { useToast } from './ToastProvider';
import { TrendingUp, TrendingDown, DollarSign, Calendar, AlertCircle, CheckCircle, X, BrainCircuit, Activity, Lock, ChevronDown } from 'lucide-react';

export default function InvestmentSimulator() {
    const { authFetch, user, symbol, token, isVip } = useStore();
    const { showToast } = useToast();
    const [investments, setInvestments] = useState([]);
    const [loading, setLoading] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);

    // Form state
    const [selectedSymbol, setSelectedSymbol] = useState(symbol || 'BTCUSDT');
    const [usdtAmount, setUsdtAmount] = useState('1000');
    const [targetDate, setTargetDate] = useState('');

    // Analysis Result
    const [analysisResult, setAnalysisResult] = useState(null);

    // Popup State
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [notification, setNotification] = useState(null); // { type: 'success'|'info'|'closed', message, data }

    const wsRef = useRef(null);

    useEffect(() => {
        if (symbol) setSelectedSymbol(symbol);
    }, [symbol]);

    // Set default target date to 1 hour from now
    useEffect(() => {
        const now = new Date();
        now.setHours(now.getHours() + 1);
        // Format to datetime-local input format: YYYY-MM-DDTHH:MM
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const defaultDateTime = `${year}-${month}-${day}T${hours}:${minutes}`;
        setTargetDate(defaultDateTime);
    }, []);

    useEffect(() => {
        connectSSE();

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [user, token]);

    const connectSSE = () => {
        if (!user?.id || !token) return;

        // Use Gateway URL
        const gateway = 'http://localhost:8000';
        const url = `${gateway}/invest-api/v1/investments/events?user_id=${user.id}&token=${encodeURIComponent(token)}`;

        console.log('Connecting SSE:', url);
        const eventSource = new EventSource(url);

        eventSource.onmessage = (event) => {
            console.log('[SSE] Raw data received:', event.data);
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'investment_created') {
                    console.log('[SSE] Investment created event received');
                    loadInvestments();
                } else if (data.type === 'investment_closed') {
                    console.log('[SSE] Investment closed event received, showing popup');
                    loadInvestments();
                    setNotification({
                        type: 'closed',
                        message: 'Lệnh đầu tư đã kết thúc!',
                        data: data
                    });
                }
            } catch (e) {
                console.error('SSE Parse Error', e);
            }
        };

        eventSource.onerror = (error) => {
            console.error('[SSE] EventSource failed:', error);
            eventSource.close();
            setTimeout(connectSSE, 5000);
        };

        wsRef.current = eventSource;
    };

    // Pagination State
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loadingInvestments, setLoadingInvestments] = useState(false);
    const investmentCacheRef = useRef({}); // Cache: { page: { investments, totalPages } }

    // Helper to parse messy AI advice
    const getFormattedAdvice = (rawAdvice) => {
        if (!rawAdvice) return 'Không có lời khuyên.';
        try {
            // Check if rawAdvice is a JSON string
            if (typeof rawAdvice === 'string' && rawAdvice.trim().startsWith('{')) {
                const obj = JSON.parse(rawAdvice);

                // Case: The 'advice' field itself is a JSON string (double encoded)
                if (typeof obj.advice === 'string' && obj.advice.trim().startsWith('{')) {
                    try {
                        const innerObj = JSON.parse(obj.advice);
                        // Combine Risk + Action for full context
                        const parts = [];
                        
                        // Support multiple Vietnamese key variants
                        const riskKey = innerObj['rủi ro'] || innerObj['risk'];
                        const actionKey = innerObj['khuyến cáo hành động'] 
                            || innerObj['khuyên hành động'] 
                            || innerObj['khuyến nghị']
                            || innerObj['action']
                            || innerObj['recommendation'];
                        
                        if (riskKey) parts.push(`⚠️ ${riskKey}`);
                        if (actionKey) parts.push(`💡 ${actionKey}`);

                        if (parts.length > 0) return parts.join('\n\n');

                        return innerObj.message || obj.advice;
                    } catch { /* ignore inner parse error */ }
                }

                // Fallback for single level JSON
                const parts = [];
                const riskKey = obj['rủi ro'] || obj['risk'];
                const actionKey = obj['khuyến cáo hành động'] 
                    || obj['khuyên hành động'] 
                    || obj['khuyến nghị']
                    || obj['action']
                    || obj['recommendation'];
                    
                if (riskKey) parts.push(`⚠️ ${riskKey}`);
                if (actionKey) parts.push(`💡 ${actionKey}`);
                if (parts.length > 0) return parts.join('\n\n');

                return obj.thông_báo || obj.advice || obj.message || Object.values(obj)[0] || rawAdvice;
            }
        } catch (e) {
            console.error("Error parsing advice:", e);
        }
        return rawAdvice.replace(/[*#]/g, ''); // Basic clean
    };

    // UI Helper: Profit/Loss Label
    const renderProfitLabel = (value, isPercent = false) => {
        const num = parseFloat(value || 0);
        const prefix = num > 0 ? '+' : '';
        const colorClass = num >= 0 ? 'text-up' : 'text-down';
        return <span className={`text-bold ${colorClass}`}>{prefix}{num.toFixed(2)}{isPercent ? '%' : '$'}</span>;
    };

    const loadInvestments = async (pageNum = page, forceRefresh = false) => {
        if (!user?.id) return;

        // Check cache first
        if (!forceRefresh && investmentCacheRef.current[pageNum]) {
            const cached = investmentCacheRef.current[pageNum];
            setInvestments(cached.investments);
            setTotalPages(cached.totalPages);
            console.log(`[CACHE HIT] Loaded page ${pageNum} from cache`);
            return;
        }

        setLoadingInvestments(true);
        try {
            const res = await authFetch(`/v1/investments/${user.id}?page=${pageNum}&limit=5`);
            if (res.ok) {
                const data = await res.json();
                setInvestments(data.investments || []);
                if (data.pagination) {
                    setTotalPages(data.pagination.totalPages);
                    // Cache the result
                    investmentCacheRef.current[pageNum] = {
                        investments: data.investments || [],
                        totalPages: data.pagination.totalPages
                    };
                }
            }
        } catch (error) {
            console.error('Failed to load investments', error);
        } finally {
            setLoadingInvestments(false);
        }
    };

    useEffect(() => {
        loadInvestments(page);
    }, [page, user, token]); // Reload when page changes

    const handleAnalyze = async (e) => {
        e.preventDefault();
        if (!user?.id) {
            showToast('Vui lòng đăng nhập lại', 'warning');
            return;
        }

        if (!targetDate) {
            showToast('Vui lòng chọn thời gian bán', 'warning');
            return;
        }

        setAnalyzing(true);
        setAnalysisResult(null);

        try {
            const res = await authFetch('/v1/investments/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    symbol: selectedSymbol,
                    usdt_amount: parseFloat(usdtAmount),
                    target_sell_time: new Date(targetDate).toISOString()
                })
            });

            const data = await res.json();
            if (res.ok) {
                setAnalysisResult(data.ai_recommendation);
            } else {
                showToast(data.error || 'Phân tích thất bại', 'error');
            }
        } catch (error) {
            console.error('Analyze error', error);
            showToast('Lỗi kết nối đến server phân tích', 'error');
        } finally {
            setAnalyzing(false);
        }
    };

    const handleConfirmInvestment = async () => {
        setShowConfirmModal(false);
        setLoading(true);

        try {
            const res = await authFetch('/v1/investments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: user.id,
                    symbol: selectedSymbol,
                    usdt_amount: parseFloat(usdtAmount),
                    target_sell_time: new Date(targetDate).toISOString(),
                    ai_analysis: analysisResult // Gửi kết quả phân tích có sẵn để tránh gọi AI service lần nữa
                })
            });

            const data = await res.json();
            if (res.ok) {
                // Clear cache and reload
                investmentCacheRef.current = {};
                setPage(1); // Go to first page
                loadInvestments(1, true); // Force refresh

                setNotification({
                    type: 'success',
                    message: 'Đầu tư thành công!',
                    data: data.investment
                });
                setAnalysisResult(null); // Reset form
                setTargetDate('');
            } else {
                showToast(data.error || 'Tạo đầu tư thất bại', 'error');
            }
        } catch (error) {
            showToast('Lỗi khi tạo đầu tư', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="investment-simulator">
            {!isVip ? (
                <div className="vip-lock-container">
                    <Lock className="vip-lock-icon" size={64} />
                    <h3>Tính Năng VIP</h3>
                    <p>Mô phỏng đầu tư với AI chỉ dành cho tài khoản VIP.</p>
                    <p className="vip-benefits">
                        ✨ Phân tích AI chuyên sâu<br />
                        📊 Dự đoán lợi nhuận chính xác<br />
                        🎯 Theo dõi danh mục đầu tư<br />
                        🤖 Lời khuyên từ mô hình Deep Learning
                    </p>
                    <button className="upgrade-btn" onClick={() => {
                        // Trigger upgrade modal from parent
                        window.dispatchEvent(new CustomEvent('showUpgradeModal'));
                    }}>
                        Nâng Cấp VIP Ngay
                    </button>
                </div>
            ) : (
                <>
                    <h2>
                        <BrainCircuit className="brand-icon" size={32} />
                        Mô Phỏng Đầu Tư AI
                    </h2>

                    <div className="simulator-grid">
                        {/* Left: Control Panel */}
                        <div className="sidebar-col">
                            <div className="card">
                                <h3>Tham Số Đầu Tư</h3>
                                <form onSubmit={handleAnalyze}>
                                    <div className="input-group">
                                        <label>Cặp Coin</label>
                                        <div className="input-wrapper">
                                            <select
                                                value={selectedSymbol}
                                                onChange={(e) => setSelectedSymbol(e.target.value)}
                                                className="styled-input"
                                                style={{ paddingLeft: '12px', paddingRight: '32px', appearance: 'none', cursor: 'pointer' }}
                                            >
                                                {['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'DOGEUSDT', 'ADAUSDT', 'XRPUSDT', 'AVAXUSDT', 'DOTUSDT', 'POLUSDT'].map(s => (
                                                    <option key={s} value={s}>{s}</option>
                                                ))}
                                            </select>
                                            <ChevronDown className="input-icon" size={18} style={{ left: 'auto', right: '12px', color: 'var(--text-secondary)' }} />
                                        </div>
                                    </div>

                                    <div className="input-group">
                                        <label>Số Vốn (USDT)</label>
                                        <div className="input-wrapper">
                                            <DollarSign className="input-icon" size={18} />
                                            <input
                                                type="number"
                                                value={usdtAmount}
                                                onChange={(e) => setUsdtAmount(e.target.value)}
                                                className="styled-input"
                                            />
                                        </div>
                                    </div>

                                    <div className="input-group">
                                        <label>Thời điểm Bán (Mục tiêu)</label>
                                        <div className="input-wrapper">
                                            <Calendar className="input-icon" size={18} />
                                            <input
                                                type="datetime-local"
                                                value={targetDate}
                                                onChange={(e) => setTargetDate(e.target.value)}
                                                className="styled-input"
                                            />
                                        </div>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={analyzing || loading}
                                        className="btn-primary"
                                    >
                                        {analyzing ? (
                                            <>
                                                <Activity className="animate-spin" size={20} />
                                                Đang Phân Tích...
                                            </>
                                        ) : (
                                            <>
                                                <BrainCircuit size={20} />
                                                Phân Tích Với AI
                                            </>
                                        )}
                                    </button>
                                </form>
                            </div>

                            {/* AI Analysis Result Preview */}
                            {analysisResult && (
                                <div className="analysis-preview card">
                                    <div className="analysis-header">
                                        <AlertCircle size={20} />
                                        Kết Quả Phân Tích AI
                                    </div>

                                    <div className="advice-text">
                                        "{getFormattedAdvice(analysisResult.advice)}"
                                    </div>

                                    <div className="stats-grid">
                                        <div className="stat-item">
                                            <div className="stat-label">Xu hướng</div>
                                            <div className={`stat-value ${analysisResult.direction === 'UP' ? 'text-up' : 'text-down'}`}>
                                                {analysisResult.direction}
                                            </div>
                                        </div>
                                        <div className="stat-item">
                                            <div className="stat-label">Tin cậy</div>
                                            <div className="stat-value" style={{ color: 'var(--accent-yellow)' }}>
                                                {(analysisResult.confidence * 10).toFixed(0)}%
                                            </div>
                                        </div>
                                        <div className="stat-item">
                                            <div className="stat-label">Lợi Nhuận</div>
                                            <div className="stat-value">{renderProfitLabel(analysisResult.predicted_profit_usdt)}</div>
                                        </div>
                                        <div className="stat-item">
                                            <div className="stat-label">% Dự Kiến</div>
                                            <div className="stat-value">{renderProfitLabel(analysisResult.predicted_profit_percent, true)}</div>
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => setShowConfirmModal(true)}
                                        className="btn-primary btn-success"
                                    >
                                        <CheckCircle size={20} />
                                        Xác Nhận Đầu Tư
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Right: History & Active Investments */}
                        <div className="history-col">
                            <div className="investment-table-container">
                                <div className="table-header">
                                    Danh Sách Đầu Tư Của Bạn
                                </div>
                                <div className="simulator-table-wrapper">
                                    <table className="simulator-table">
                                        <thead>
                                            <tr>
                                                <th>Coin</th>
                                                <th>Thời Gian Mua</th>
                                                <th>Giá Mua</th>
                                                <th>Dự Đoán AI</th>
                                                <th>Trạng Thái</th>
                                                <th style={{ textAlign: 'right' }}>Kết Quả</th>
                                            </tr>
                                        </thead>
                                        <tbody style={{ opacity: loadingInvestments ? 0.5 : 1, transition: 'opacity 0.2s' }}>
                                            {loadingInvestments && investments.length === 0 ? (
                                                // Loading skeleton
                                                [...Array(5)].map((_, i) => (
                                                    <tr key={`skeleton-${i}`}>
                                                        <td colSpan="6" style={{ padding: '16px' }}>
                                                            <div style={{
                                                                height: '20px',
                                                                background: 'linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-tertiary) 50%, var(--bg-secondary) 75%)',
                                                                backgroundSize: '200% 100%',
                                                                animation: 'shimmer 1.5s infinite',
                                                                borderRadius: '4px'
                                                            }}></div>
                                                        </td>
                                                    </tr>
                                                ))
                                            ) : (
                                                <>
                                                    {investments.map(inv => (
                                                        <tr key={inv.id}>
                                                            <td className="text-bold" style={{ color: 'var(--accent-blue)' }}>{inv.symbol}</td>
                                                            <td>
                                                                {new Date(inv.buy_time).toLocaleTimeString()}
                                                                <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>{new Date(inv.buy_time).toLocaleDateString()}</div>
                                                            </td>
                                                            <td className="text-mono">${parseFloat(inv.buy_price).toLocaleString()}</td>
                                                            <td>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                    {inv.ai_prediction?.direction === 'UP' ? <TrendingUp size={16} className="text-up" /> : <TrendingDown size={16} className="text-down" />}
                                                                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>({(inv.ai_prediction?.confidence || 0)}/5)</span>
                                                                </div>
                                                            </td>
                                                            <td>
                                                                <span className={`status-badge ${inv.status === 'active' ? 'status-active' : 'status-closed'}`}>
                                                                    {inv.status === 'active' ? 'Đang chạy' : 'Đã đóng'}
                                                                </span>
                                                            </td>
                                                            <td style={{ textAlign: 'right' }} className="text-mono">
                                                                {inv.status === 'closed' ? (
                                                                    renderProfitLabel(inv.actual_profit_usdt)
                                                                ) : (
                                                                    <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: '11px' }}>---</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                    {investments.length === 0 && !loadingInvestments && (
                                                        <tr>
                                                            <td colSpan="6" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                                                Chưa có lệnh đầu tư nào. Hãy bắt đầu phân tích!
                                                            </td>
                                                        </tr>
                                                    )}
                                                </>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                {/* Pagination Controls */}
                                <div className="pagination-controls" style={{ display: 'flex', justifyContent: 'center', gap: '16px', padding: '16px', borderTop: '1px solid var(--border-color)' }}>
                                    <button
                                        className="btn-secondary"
                                        disabled={page === 1}
                                        onClick={() => setPage(p => Math.max(1, p - 1))}
                                        style={{ padding: '4px 12px', fontSize: '12px' }}
                                    >
                                        &lt; Trước
                                    </button>
                                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', alignSelf: 'center' }}>
                                        Trang {page} / {totalPages || 1}
                                    </span>
                                    <button
                                        className="btn-secondary"
                                        disabled={page >= totalPages}
                                        onClick={() => setPage(p => p + 1)}
                                        style={{ padding: '4px 12px', fontSize: '12px' }}
                                    >
                                        Sau &gt;
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Confirm Modal */}
                    {showConfirmModal && (
                        <div className="modal-overlay">
                            <div className="modal-content">
                                <h3 className="modal-title">Xác Nhận Đầu Tư?</h3>
                                <div className="modal-body">
                                    Bạn sắp mở lệnh mua <b>{selectedSymbol}</b> với giá trị <b>${usdtAmount}</b>.<br />
                                    Lệnh sẽ tự động bán vào lúc: <br />
                                    <span className="text-bold" style={{ color: 'var(--accent-blue)' }}>{new Date(targetDate).toLocaleString()}</span>
                                </div>
                                <div className="modal-footer">
                                    <button
                                        onClick={() => setShowConfirmModal(false)}
                                        className="btn-secondary"
                                    >
                                        Hủy Bỏ
                                    </button>
                                    <button
                                        onClick={handleConfirmInvestment}
                                        className="btn-primary"
                                        style={{ flex: 1 }}
                                    >
                                        Xác Nhận Mua
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Notification Modal */}
                    {notification && (
                        <div className="modal-overlay">
                            <div className="modal-content">
                                <button
                                    onClick={() => setNotification(null)}
                                    className="modal-close"
                                >
                                    <X size={24} />
                                </button>

                                <div style={{ textAlign: 'center' }}>
                                    {notification.type === 'success' ? (
                                        <CheckCircle className="modal-icon-large text-up" />
                                    ) : (
                                        <DollarSign className="modal-icon-large text-down" style={{ color: 'var(--accent-yellow)' }} />
                                    )}

                                    <h3 className="modal-title">{notification.message}</h3>

                                    {notification.type === 'closed' && (
                                        <div className="modal-result-box">
                                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Kết quả thực tế</div>
                                            <div style={{ fontSize: '32px', marginBottom: '12px' }}>
                                                {renderProfitLabel(notification.data.actual_profit_usdt)}
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                Dự báo ban đầu: {renderProfitLabel(notification.data.predicted_profit_usdt)}
                                                <br />
                                                Độ chính xác AI: <span style={{ color: 'var(--accent-blue)', fontWeight: 'bold' }}>{parseFloat(notification.data.ai_accuracy).toFixed(1)}%</span>
                                            </div>
                                        </div>
                                    )}

                                    {notification.type === 'success' && (
                                        <div style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>
                                            Hệ thống sẽ tự động chốt lệnh khi đến thời điểm mục tiêu.
                                        </div>
                                    )}

                                    <button
                                        onClick={() => setNotification(null)}
                                        className="btn-primary"
                                        style={{ marginTop: '24px' }}
                                    >
                                        Tuyệt vời
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

import React, { useState, useEffect, useRef } from 'react';
import useStore from '../store';
import { TrendingUp, TrendingDown, DollarSign, Calendar, AlertCircle, CheckCircle, X, BrainCircuit, Activity } from 'lucide-react';

export default function InvestmentSimulator() {
    const { authFetch, user, symbol, token } = useStore();
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

    useEffect(() => {
        loadInvestments();
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

    const loadInvestments = async () => {
        if (!user?.id) return;
        try {
            const res = await authFetch(`/v1/investments/${user.id}`);
            if (res.ok) {
                const data = await res.json();
                setInvestments(data.investments || []);
            }
        } catch (error) {
            console.error('Failed to load investments', error);
        }
    };

    const handleAnalyze = async (e) => {
        e.preventDefault();
        if (!user?.id) {
            alert('Vui lòng đăng nhập lại.');
            return;
        }

        if (!targetDate) {
            alert('Vui lòng chọn thời gian bán.');
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
                alert(data.error || 'Phân tích thất bại');
            }
        } catch (error) {
            console.error('Analyze error', error);
            alert('Lỗi kết nối đến server phân tích.');
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
                loadInvestments();
                setNotification({
                    type: 'success',
                    message: 'Đầu tư thành công!',
                    data: data.investment
                });
                setAnalysisResult(null); // Reset form
                setTargetDate('');
            } else {
                alert(data.error || 'Tạo đầu tư thất bại');
            }
        } catch (error) {
            alert('Lỗi khi tạo đầu tư.');
        } finally {
            setLoading(false);
        }
    };

    // Helper to parse messy AI advice
    const getFormattedAdvice = (rawAdvice) => {
        if (!rawAdvice) return 'Không có lời khuyên.';
        try {
            if (rawAdvice.trim().startsWith('{')) {
                const obj = JSON.parse(rawAdvice);
                return obj.thông_báo || obj.advice || obj.message || Object.values(obj)[0] || rawAdvice;
            }
        } catch { }
        return rawAdvice.replace(/[*#]/g, ''); // Basic clean
    };

    // UI Helper: Profit/Loss Label
    const renderProfitLabel = (value, isPercent = false) => {
        const num = parseFloat(value || 0);
        const prefix = num > 0 ? '+' : '';
        const colorClass = num >= 0 ? 'text-up' : 'text-down';
        return <span className={`text-bold ${colorClass}`}>{prefix}{num.toFixed(2)}{isPercent ? '%' : '$'}</span>;
    };

    return (
        <div className="investment-simulator">
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
                                    <input
                                        type="text"
                                        value={selectedSymbol}
                                        onChange={(e) => setSelectedSymbol(e.target.value.toUpperCase())}
                                        className="styled-input"
                                        style={{ paddingLeft: '12px' }}
                                    />
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
                                        {(analysisResult.confidence * 100).toFixed(0)}%
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
                                <tbody>
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
                                    {investments.length === 0 && (
                                        <tr>
                                            <td colSpan="6" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                                Chưa có lệnh đầu tư nào. Hãy bắt đầu phân tích!
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
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
        </div>
    );
}

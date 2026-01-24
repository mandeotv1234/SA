import React, { useState, useEffect, useRef } from 'react';
import useStore from '../store';
import { TrendingUp, TrendingDown, DollarSign, Calendar, AlertCircle, CheckCircle } from 'lucide-react';

export default function InvestmentSimulator() {
    const { authFetch, user, symbol, token } = useStore();
    const [investments, setInvestments] = useState([]);
    const [loading, setLoading] = useState(false);

    // Form state
    const [selectedSymbol, setSelectedSymbol] = useState(symbol || 'BTCUSDT');
    const [usdtAmount, setUsdtAmount] = useState('');
    const [targetDate, setTargetDate] = useState('');
    const [aiRecommendation, setAiRecommendation] = useState(null);

    const wsRef = useRef(null);

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

        // Use Gateway URL with invest-api prefix
        // Hardcode localhost:8000 for now or use ENV
        const gateway = 'http://localhost:8000';
        const url = `${gateway}/invest-api/v1/investments/events?user_id=${user.id}&token=${encodeURIComponent(token)}`;

        console.log('Connecting SSE:', url);
        const eventSource = new EventSource(url);

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('SSE Message:', data);

                if (data.type === 'connected') {
                    console.log('SSE Connected');
                } else if (data.type === 'investment_created') {
                    loadInvestments();
                    alert('Đầu tư đã được tạo thành công!');
                } else if (data.type === 'investment_closed') {
                    loadInvestments();
                    showNotification(data);
                }
            } catch (e) {
                console.error('SSE Parse Error', e);
            }
        };

        eventSource.onerror = (error) => {
            console.error('SSE Error', error);
            eventSource.close();
            // Retry after 5s
            setTimeout(connectSSE, 5000);
        };

        wsRef.current = eventSource; // Re-use ref for cleanup
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

    const createInvestment = async (e) => {
        e.preventDefault();

        if (!user || !user.id) {
            alert('Vui lòng đăng nhập lại để thực hiện tính năng này.');
            return;
        }

        setLoading(true);

        try {
            const res = await authFetch('/v1/investments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: user.id,
                    symbol: selectedSymbol,
                    usdt_amount: parseFloat(usdtAmount),
                    target_sell_time: new Date(targetDate).toISOString()
                })
            });

            if (res.ok) {
                const data = await res.json();
                setAiRecommendation(data.ai_recommendation);
                setUsdtAmount('');
                setTargetDate('');
                loadInvestments();
            } else {
                const error = await res.json();
                alert(error.error || 'Tạo đầu tư thất bại');
            }
        } catch (error) {
            console.error('Create investment failed', error);
            alert('Lỗi kết nối');
        } finally {
            setLoading(false);
        }
    };

    const sellInvestment = async (id) => {
        if (!confirm('Bạn có chắc muốn bán ngay bây giờ?')) return;

        try {
            const res = await authFetch(`/v1/investments/${id}/sell`, {
                method: 'POST'
            });

            if (res.ok) {
                loadInvestments();
            }
        } catch (error) {
            console.error('Sell failed', error);
        }
    };

    const showNotification = (data) => {
        const isProfit = data.result === 'profit';
        const message = `
${data.symbol} đã đóng!
${isProfit ? '💰 Lời' : '📉 Lỗ'}: ${Math.abs(data.actual_profit_usdt).toFixed(2)} USDT (${data.actual_profit_percent.toFixed(2)}%)
AI dự đoán: ${data.predicted_profit_usdt.toFixed(2)} USDT
Độ chính xác: ${data.ai_accuracy.toFixed(1)}%
        `;
        alert(message);
    };

    return (
        <div className="investment-simulator">
            <h2>🎯 Mô phỏng Đầu tư với AI</h2>

            {/* Create Investment Form */}
            <div className="create-form">
                <h3>Tạo đầu tư mới</h3>
                <form onSubmit={createInvestment}>
                    <div className="form-group">
                        <label>Cặp tiền</label>
                        <select value={selectedSymbol} onChange={(e) => setSelectedSymbol(e.target.value)}>
                            <option value="BTCUSDT">BTC/USDT</option>
                            <option value="ETHUSDT">ETH/USDT</option>
                            <option value="BNBUSDT">BNB/USDT</option>
                            <option value="SOLUSDT">SOL/USDT</option>
                            <option value="XRPUSDT">XRP/USDT</option>
                        </select>
                    </div>

                    <div className="form-group">
                        <label>Số tiền (USDT)</label>
                        <input
                            type="number"
                            step="0.01"
                            value={usdtAmount}
                            onChange={(e) => setUsdtAmount(e.target.value)}
                            placeholder="Nhập số USDT"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Thời điểm bán</label>
                        <input
                            type="datetime-local"
                            value={targetDate}
                            onChange={(e) => setTargetDate(e.target.value)}
                            required
                        />
                    </div>

                    <button type="submit" disabled={loading}>
                        {loading ? 'Đang xử lý...' : 'Tạo đầu tư'}
                    </button>
                </form>

                {/* AI Recommendation */}
                {aiRecommendation && (
                    <div className={`ai-recommendation ${aiRecommendation.direction.toLowerCase()}`}>
                        <h4>💡 Tư vấn từ AI</h4>
                        <div className="advice">{aiRecommendation.advice}</div>
                        <div className="prediction-details">
                            <div>Dự đoán: {aiRecommendation.direction} {aiRecommendation.predicted_profit_percent > 0 ? '+' : ''}{aiRecommendation.predicted_profit_percent.toFixed(2)}%</div>
                            <div>Lời/lỗ dự kiến: {aiRecommendation.predicted_profit_usdt.toFixed(2)} USDT</div>
                            <div>Độ tin cậy: {(aiRecommendation.confidence * 100).toFixed(0)}%</div>
                        </div>
                    </div>
                )}
            </div>

            {/* Investments List */}
            <div className="investments-list">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                    <h3 style={{ margin: 0 }}>Danh sách đầu tư</h3>
                    <button onClick={loadInvestments} style={{ padding: '5px 10px', fontSize: '12px', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 4, color: 'white', cursor: 'pointer' }}>
                        🔄 Làm mới
                    </button>
                </div>
                {investments.length === 0 ? (
                    <p className="empty">Chưa có đầu tư nào</p>
                ) : (
                    investments.map(inv => (
                        <div key={inv.id} className={`investment-card ${inv.status}`}>
                            <div className="inv-header">
                                <span className="symbol">{inv.symbol}</span>
                                <span className={`status ${inv.status}`}>{inv.status === 'active' ? '🟢 Đang mở' : '⚫ Đã đóng'}</span>
                            </div>

                            <div className="inv-details">
                                <div className="detail-row">
                                    <span>Vốn đầu tư:</span>
                                    <strong>{parseFloat(inv.usdt_amount).toFixed(2)} USDT</strong>
                                </div>
                                <div className="detail-row">
                                    <span>Giá mua:</span>
                                    <span>{parseFloat(inv.buy_price).toFixed(2)}</span>
                                </div>
                                {inv.status === 'closed' && (
                                    <>
                                        <div className="detail-row">
                                            <span>Giá bán:</span>
                                            <span>{parseFloat(inv.sell_price).toFixed(2)}</span>
                                        </div>
                                        <div className={`detail-row profit ${inv.actual_profit_usdt >= 0 ? 'positive' : 'negative'}`}>
                                            <span>Kết quả:</span>
                                            <strong>{inv.actual_profit_usdt >= 0 ? '+' : ''}{parseFloat(inv.actual_profit_usdt).toFixed(2)} USDT</strong>
                                        </div>
                                        <div className="detail-row">
                                            <span>AI dự đoán:</span>
                                            <span>{parseFloat(inv.predicted_profit_usdt).toFixed(2)} USDT</span>
                                        </div>
                                    </>
                                )}
                            </div>

                            {inv.status === 'active' && (
                                <button className="sell-btn" onClick={() => sellInvestment(inv.id)}>
                                    Bán ngay
                                </button>
                            )}
                        </div>
                    ))
                )}
            </div>

            <style>{`
                .investment-simulator {
                    padding: 20px;
                    max-width: 1200px;
                    margin: 0 auto;
                }
                
                .investment-simulator h2 {
                    margin-bottom: 20px;
                    color: var(--accent-yellow);
                }
                
                .create-form {
                    background: rgba(255,255,255,0.05);
                    padding: 20px;
                    border-radius: 12px;
                    margin-bottom: 30px;
                }
                
                .form-group {
                    margin-bottom: 15px;
                }
                
                .form-group label {
                    display: block;
                    margin-bottom: 5px;
                    font-size: 14px;
                    color: #aaa;
                }
                
                .form-group input,
                .form-group select {
                    width: 100%;
                    padding: 10px;
                    background: rgba(0,0,0,0.3);
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 6px;
                    color: white;
                    font-size: 14px;
                }
                
                .create-form button {
                    width: 100%;
                    padding: 12px;
                    background: var(--accent-yellow);
                    color: black;
                    border: none;
                    border-radius: 6px;
                    font-weight: bold;
                    cursor: pointer;
                    margin-top: 10px;
                }
                
                .create-form button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                
                .ai-recommendation {
                    margin-top: 20px;
                    padding: 15px;
                    border-radius: 8px;
                    border-left: 4px solid;
                }
                
                .ai-recommendation.up {
                    background: rgba(16, 185, 129, 0.1);
                    border-color: var(--accent-green);
                }
                
                .ai-recommendation.down {
                    background: rgba(239, 68, 68, 0.1);
                    border-color: var(--accent-red);
                }
                
                .ai-recommendation.neutral {
                    background: rgba(255,255,255,0.05);
                    border-color: #888;
                }
                
                .ai-recommendation h4 {
                    margin-bottom: 10px;
                }
                
                .advice {
                    white-space: pre-line;
                    margin-bottom: 10px;
                    font-size: 14px;
                    line-height: 1.6;
                }
                
                .prediction-details {
                    font-size: 12px;
                    color: #999;
                }
                
                .prediction-details div {
                    margin-top: 5px;
                }
                
                .investments-list h3 {
                    margin-bottom: 15px;
                }
                
                .investment-card {
                    background: rgba(255,255,255,0.03);
                    padding: 15px;
                    border-radius: 8px;
                    margin-bottom: 10px;
                    border: 1px solid rgba(255,255,255,0.1);
                }
                
                .inv-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                }
                
                .inv-header .symbol {
                    font-size: 16px;
                    font-weight: bold;
                }
                
                .inv-header .status {
                    font-size: 12px;
                }
                
                .detail-row {
                    display: flex;
                    justify-content: space-between;
                    padding: 5px 0;
                    font-size: 13px;
                }
                
                .detail-row.profit.positive {
                    color: var(--accent-green);
                }
                
                .detail-row.profit.negative {
                    color: var(--accent-red);
                }
                
                .sell-btn {
                    width: 100%;
                    padding: 8px;
                    background: var(--accent-red);
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    margin-top: 10px;
                    font-size: 13px;
                }
                
                .empty {
                    text-align: center;
                    color: #666;
                    padding: 40px;
                }
            `}</style>
        </div>
    );
}

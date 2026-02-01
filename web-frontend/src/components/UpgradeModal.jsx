import React, { useState, useEffect } from 'react';
import { X, Copy, Loader, CheckCircle, XCircle, Clock } from 'lucide-react';
import useStore from '../store';
import { useToast } from './ToastProvider';

const MY_BANK = {
    BANK_ID: "MBBank",
    ACCOUNT_NO: "0398103087",
    ACCOUNT_NAME: "HUỲNH MẪN",
    TEMPLATE: "compact",
};

const PAYMENT_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const POLL_INTERVAL = 3000; // 3 seconds

export default function UpgradeModal({ onClose }) {
    const { token, isVip, setIsVip, authFetch } = useStore();
    const { showToast } = useToast();
    const [step, setStep] = useState(1);
    const [userId, setUserId] = useState(null);
    const [loadingCode, setLoadingCode] = useState(true);
    const [paymentStatus, setPaymentStatus] = useState('idle'); // idle, waiting, success, failed, expired
    const [timeRemaining, setTimeRemaining] = useState(PAYMENT_TIMEOUT);

    useEffect(() => {
        if (!token) return;
        // Decode token to get user ID
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            setUserId(payload.sub);
            setLoadingCode(false);
        } catch (e) {
            console.error("Failed to decode token", e);
            setLoadingCode(false);
        }
    }, [token]);

    // Countdown timer
    useEffect(() => {
        if (paymentStatus === 'waiting' && timeRemaining > 0) {
            const timer = setTimeout(() => {
                setTimeRemaining(prev => prev - 1000);
            }, 1000);
            return () => clearTimeout(timer);
        } else if (paymentStatus === 'waiting' && timeRemaining <= 0) {
            setPaymentStatus('expired');
        }
    }, [paymentStatus, timeRemaining]);



    // Watch for VIP status update from Store (Socket.IO)
    useEffect(() => {
        if (isVip && paymentStatus !== 'success') {
            console.log('VIP status updated via Socket! Show success.');
            setPaymentStatus('success');
            setTimeout(() => onClose(), 3000);
        }
    }, [isVip, paymentStatus, onClose]);

    // Manual check only (no polling)
    const checkVipStatus = async () => {
        try {
            console.log('Manual VIP status check...');
            const res = await authFetch('/auth/me');

            if (res.ok) {
                const data = await res.json();
                if (data.user && data.user.is_vip) {
                    setIsVip(true); // This will trigger the effect above
                }
            }
        } catch (error) {
            console.error('Failed to check VIP status:', error);
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        showToast('Đã sao chép vào bộ nhớ đệm!', 'success');
    };

    const formatTime = (ms) => {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const handlePaymentClick = () => {
        setPaymentStatus('waiting');
        setTimeRemaining(PAYMENT_TIMEOUT);
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000
        }}>
            <div style={{
                backgroundColor: '#1e222d', padding: 24, borderRadius: 12, width: '400px',
                color: 'white', position: 'relative', border: '1px solid #2a2e39'
            }}>
                <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}>
                    <X size={20} />
                </button>

                <h2 style={{ fontSize: 20, marginBottom: 16, textAlign: 'center' }}>Nâng cấp VIP</h2>

                {step === 1 && (
                    <div>
                        <p style={{ color: '#9ca3af', marginBottom: 24, textAlign: 'center' }}>
                            Mở khóa các phân tích AI chuyên sâu và nhận dự báo thời gian thực.
                        </p>

                        <div style={{ backgroundColor: '#2a2e39', padding: 16, borderRadius: 8, marginBottom: 24 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                <span style={{ color: '#9ca3af' }}>Giá tiền</span>
                                <span style={{ fontWeight: 'bold', color: '#26a69a' }}>10,000 VNĐ</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#9ca3af' }}>Gói dịch vụ</span>
                                <span style={{ fontWeight: 'bold' }}>Truy cập trọn đời</span>
                            </div>
                        </div>

                        <button
                            onClick={() => setStep(2)}
                            className="login-btn"
                            style={{ width: '100%', padding: 12, borderRadius: 4, cursor: 'pointer', display: 'flex', justifyContent: 'center', alignItems: 'center' }}
                        >
                            Tiếp tục thanh toán
                        </button>
                    </div>
                )}

                {step === 2 && paymentStatus === 'idle' && (
                    <div>
                        {loadingCode ? <div style={{ textAlign: 'center' }}><Loader className="spin" /></div> : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 16, textAlign: 'center' }}>
                                    Quét mã QR để thanh toán ngay
                                </p>

                                <div style={{ backgroundColor: 'white', padding: 12, borderRadius: 8, marginBottom: 16 }}>
                                    <img
                                        src={`https://img.vietqr.io/image/${MY_BANK.BANK_ID}-${MY_BANK.ACCOUNT_NO}-${MY_BANK.TEMPLATE}.png?amount=10000&addInfo=VIP%20${userId}&accountName=${encodeURIComponent(MY_BANK.ACCOUNT_NAME)}`}
                                        alt="Mã QR Thanh Toán"
                                        style={{ width: '200px', height: 'auto' }}
                                    />
                                </div>

                                <div style={{ width: '100%', marginBottom: 16, fontSize: 13, color: '#e5e7eb' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, borderBottom: '1px solid #2a2e39', paddingBottom: 8 }}>
                                        <span style={{ color: '#9ca3af' }}>Ngân hàng</span>
                                        <span style={{ fontWeight: 'bold' }}>MB Bank</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, borderBottom: '1px solid #2a2e39', paddingBottom: 8 }}>
                                        <span style={{ color: '#9ca3af' }}>Chủ tài khoản</span>
                                        <span style={{ fontWeight: 'bold' }}>{MY_BANK.ACCOUNT_NAME}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, borderBottom: '1px solid #2a2e39', paddingBottom: 8 }}>
                                        <span style={{ color: '#9ca3af' }}>Số tài khoản</span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontWeight: 'bold', fontFamily: 'monospace' }}>{MY_BANK.ACCOUNT_NO}</span>
                                            <button onClick={() => copyToClipboard(MY_BANK.ACCOUNT_NO)} style={{ background: 'none', border: 'none', color: '#26a69a', cursor: 'pointer', padding: 0 }}>
                                                <Copy size={14} />
                                            </button>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, borderBottom: '1px solid #2a2e39', paddingBottom: 8 }}>
                                        <span style={{ color: '#9ca3af' }}>Số tiền</span>
                                        <span style={{ fontWeight: 'bold', color: '#26a69a' }}>10,000 VNĐ</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ color: '#9ca3af' }}>Nội dung</span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ fontWeight: 'bold', color: '#f23645' }}>VIP {userId}</span>
                                            <button onClick={() => copyToClipboard(`VIP ${userId}`)} style={{ background: 'none', border: 'none', color: '#26a69a', cursor: 'pointer', padding: 0 }}>
                                                <Copy size={14} />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <button
                                    onClick={handlePaymentClick}
                                    style={{
                                        width: '100%', padding: 12, borderRadius: 4, cursor: 'pointer',
                                        backgroundColor: '#26a69a', color: 'white', border: 'none', fontWeight: 'bold'
                                    }}
                                >
                                    Tôi đã chuyển khoản
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {paymentStatus === 'waiting' && (
                    <div style={{ textAlign: 'center', padding: 20 }}>
                        <Loader className="spin" size={48} style={{ margin: '0 auto 16px', color: '#26a69a' }} />
                        <h3 style={{ marginBottom: 8 }}>Đang kiểm tra thanh toán...</h3>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#9ca3af', marginBottom: 16 }}>
                            <Clock size={16} />
                            <span>Thời gian còn lại: {formatTime(timeRemaining)}</span>
                        </div>
                        <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 16 }}>
                            Vui lòng đợi trong khi chúng tôi xác nhận thanh toán. Quá trình này có thể mất vài phút.
                        </p>
                        <button
                            onClick={checkVipStatus}
                            style={{
                                background: 'transparent', border: '1px solid #26a69a', color: '#26a69a',
                                padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12
                            }}
                        >
                            Kiểm tra ngay
                        </button>
                    </div>
                )}

                {paymentStatus === 'success' && (
                    <div style={{ textAlign: 'center', padding: 20 }}>
                        <CheckCircle size={64} style={{ margin: '0 auto 16px', color: '#26a69a' }} />
                        <h3 style={{ color: '#26a69a', marginBottom: 8 }}>Thanh toán thành công!</h3>
                        <p style={{ fontSize: 13, color: '#9ca3af' }}>
                            Tài khoản của bạn đã được nâng cấp lên VIP. Đang tải lại...
                        </p>
                    </div>
                )}

                {(paymentStatus === 'failed' || paymentStatus === 'expired') && (
                    <div style={{ textAlign: 'center', padding: 20 }}>
                        <XCircle size={64} style={{ margin: '0 auto 16px', color: '#f23645' }} />
                        <h3 style={{ color: '#f23645', marginBottom: 8 }}>
                            {paymentStatus === 'expired' ? 'Thanh toán hết hạn' : 'Thanh toán thất bại'}
                        </h3>
                        <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 16 }}>
                            {paymentStatus === 'expired'
                                ? 'Thời gian thanh toán đã hết. Vui lòng thử lại.'
                                : 'Không thể xử lý thanh toán của bạn. Vui lòng thử lại.'}
                        </p>
                        <button
                            onClick={() => {
                                setPaymentStatus('idle');
                                setStep(1);
                                setTimeRemaining(PAYMENT_TIMEOUT);
                            }}
                            style={{
                                padding: '8px 16px', borderRadius: 4, cursor: 'pointer',
                                backgroundColor: '#26a69a', color: 'white', border: 'none', fontWeight: 'bold'
                            }}
                        >
                            Thử lại
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

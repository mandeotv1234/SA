import React, { useState, useEffect } from 'react';
import useStore from '../store';
import SymbolSelector from './SymbolSelector';
import { useToast } from './ToastProvider';
import { User, Activity, LogOut, CheckCircle, BarChart3, TrendingUp, Sparkles } from 'lucide-react';

export default function Navbar({ currentPage, onNavigate }) {
    const { logout, isVip, price } = useStore();
    const { showToast } = useToast();

    // Listen for VIP upgrade event
    useEffect(() => {
        const handleUpgrade = () => {
            showToast('Chúc mừng! Tài khoản đã được nâng cấp VIP!', 'success');
            // Play sound effect?
            const audio = new Audio('/success.mp3'); // Mock path
            audio.play().catch(() => { });
        };

        window.addEventListener('vip_upgraded', handleUpgrade);
        return () => window.removeEventListener('vip_upgraded', handleUpgrade);
    }, [showToast]);

    return (
        <div className="navbar">
            <div className="nav-left">
                <div className="brand">
                    <Activity className="brand-icon" />
                    <span>TradeAI</span>
                </div>

                {/* Navigation Tabs */}
                <div className="nav-tabs">
                    <button
                        className={`nav-tab ${currentPage === 'trading' ? 'active' : ''}`}
                        onClick={() => onNavigate('trading')}
                    >
                        <BarChart3 size={16} />
                        <span>Trading</span>
                    </button>
                    <button
                        className={`nav-tab ${currentPage === 'investment' ? 'active' : ''} ${!isVip ? 'vip-required' : ''}`}
                        onClick={() => onNavigate('investment')}
                        title={!isVip ? 'VIP Feature' : 'Investment Simulator'}
                    >
                        <TrendingUp size={16} />
                        <span>Investment</span>
                        {!isVip && <span className="vip-badge-mini">VIP</span>}
                    </button>
                </div>
            </div>

            <div className="nav-right">
                {price && (
                    <div className="price-display">
                        <span style={{ fontSize: '16px', fontWeight: 'bold', color: price.c >= price.o ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                            {price.c.toFixed(2)}
                        </span>
                        <span className={price.c >= price.o ? 'price-up' : 'price-down'} style={{ fontSize: '10px' }}>
                            {((price.c - price.o) / price.o * 100).toFixed(2)}%
                        </span>
                    </div>
                )}

                <div className="user-info">
                    <div className={`user-badge ${isVip ? 'vip-gold' : 'basic-gray'}`}>
                        {isVip && <Sparkles size={12} className="text-yellow-400" style={{ marginRight: 4 }} />}
                        {isVip ? 'VIP PRO' : 'BASIC'}
                        {isVip && <CheckCircle size={10} />}
                    </div>
                </div>

                <button className="logout-btn" onClick={logout} title="Logout">
                    <LogOut size={18} />
                </button>
            </div>
        </div>
    );
}

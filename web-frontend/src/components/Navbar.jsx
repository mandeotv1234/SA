import React, { useState } from 'react';
import useStore from '../store';
import SymbolSelector from './SymbolSelector';
import { User, Activity, LogOut, CheckCircle } from 'lucide-react';

export default function Navbar() {
    const { logout, isVip, price } = useStore();

    return (
        <div className="navbar">
            <div className="nav-left">
                <div className="brand">
                    <Activity className="brand-icon" />
                    <span>TradeAI</span>
                </div>
                <SymbolSelector />
                <div className="nav-separator"></div>
                <button className="timeframe-btn">1D</button>
                <button className="timeframe-btn">5D</button>
                <button className="timeframe-btn">1M</button>
                <button className="timeframe-btn">3M</button>
                <button className="timeframe-btn">6M</button>
                <button className="timeframe-btn active">1Y</button>
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

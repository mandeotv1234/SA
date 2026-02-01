import React, { useState, useEffect } from 'react';
import useStore from '../store';
import NewsList from './NewsList';
import InsightsList from './InsightsList';
import Watchlist from './Watchlist';
import { Newspaper, BrainCircuit, Lock, List } from 'lucide-react';


export default function Sidebar() {
    const { isVip } = useStore();
    const [activeTab, setActiveTab] = useState('watchlist');

    const triggerUpgrade = () => {
        window.dispatchEvent(new CustomEvent('showUpgradeModal'));
    };

    return (
        <div className="sidebar-container">
            {/* Tabs */}
            <div className="tabs">
                <button
                    onClick={() => setActiveTab('watchlist')}
                    className={`tab-btn ${activeTab === 'watchlist' ? 'active' : ''}`}
                    title="Danh sách theo dõi"
                >
                    <List size={16} />
                </button>
                <button
                    onClick={() => setActiveTab('news')}
                    className={`tab-btn ${activeTab === 'news' ? 'active' : ''}`}
                    title="Tin tức"
                >
                    <Newspaper size={16} />
                </button>
                <button
                    onClick={() => setActiveTab('insights')}
                    className={`tab-btn vip ${activeTab === 'insights' ? 'active' : ''}`}
                    title="Phân tích AI"
                >
                    <BrainCircuit size={16} />
                </button>
            </div>

            {/* Content */}
            <div className="sidebar-content">
                {activeTab === 'watchlist' && <Watchlist />}
                {activeTab === 'news' && <NewsList />}
                {activeTab === 'insights' && (
                    isVip ? <InsightsList /> : (
                        <div className="vip-lock">
                            <Lock className="vip-icon" />
                            <h3>Yêu cầu VIP</h3>
                            <p style={{ fontSize: '13px', marginTop: 8 }}>Nâng cấp tài khoản để xem phân tích AI nhân quả và dự báo giá thời gian thực.</p>
                            <button className="upgrade-btn" onClick={triggerUpgrade}>Nâng cấp ngay</button>
                        </div>
                    )
                )}
            </div>
        </div>
    );
}

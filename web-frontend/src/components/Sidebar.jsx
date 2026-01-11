import React, { useState } from 'react';
import useStore from '../store';
import NewsList from './NewsList';
import InsightsList from './InsightsList';
import Watchlist from './Watchlist';
import { Newspaper, BrainCircuit, Lock, List } from 'lucide-react';

export default function Sidebar() {
    const { isVip } = useStore();
    const [activeTab, setActiveTab] = useState('watchlist');

    return (
        <div className="sidebar-container">
            {/* Tabs */}
            <div className="tabs">
                <button
                    onClick={() => setActiveTab('watchlist')}
                    className={`tab-btn ${activeTab === 'watchlist' ? 'active' : ''}`}
                    title="Watchlist"
                >
                    <List size={16} />
                </button>
                <button
                    onClick={() => setActiveTab('news')}
                    className={`tab-btn ${activeTab === 'news' ? 'active' : ''}`}
                    title="News"
                >
                    <Newspaper size={16} />
                </button>
                <button
                    onClick={() => setActiveTab('insights')}
                    className={`tab-btn vip ${activeTab === 'insights' ? 'active' : ''}`}
                    title="AI Insights"
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
                            <h3>VIP Access Required</h3>
                            <p style={{ fontSize: '13px', marginTop: 8 }}>Upgrade your account to see real-time AI causal analysis and price predictions.</p>
                            <button className="upgrade-btn">Upgrade Now</button>
                        </div>
                    )
                )}
            </div>
        </div>
    );
}

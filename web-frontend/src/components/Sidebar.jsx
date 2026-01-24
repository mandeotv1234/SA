import React, { useState } from 'react';
import useStore from '../store';
import NewsList from './NewsList';
import InsightsList from './InsightsList';
import Watchlist from './Watchlist';
import InvestmentSimulator from './InvestmentSimulator';
import { Newspaper, BrainCircuit, Lock, List, TrendingUp } from 'lucide-react';

import UpgradeModal from './UpgradeModal';

export default function Sidebar() {
    const { isVip } = useStore();
    const [activeTab, setActiveTab] = useState('watchlist');
    const [showUpgradeModal, setShowUpgradeModal] = useState(false);

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
                <button
                    onClick={() => setActiveTab('investment')}
                    className={`tab-btn ${activeTab === 'investment' ? 'active' : ''}`}
                    title="Investment Simulator"
                >
                    <TrendingUp size={16} />
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
                            <button className="upgrade-btn" onClick={() => setShowUpgradeModal(true)}>Upgrade Now</button>
                        </div>
                    )
                )}
                {activeTab === 'investment' && <InvestmentSimulator />}
            </div>

            {showUpgradeModal && <UpgradeModal onClose={() => setShowUpgradeModal(false)} />}
        </div>
    );
}

import React, { useEffect, useState } from 'react';
import useStore from './store';
import Login from './components/Login.jsx';
import TradingDashboard from './components/TradingDashboard';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import LeftToolbar from './components/LeftToolbar';
import InvestmentSimulator from './components/InvestmentSimulator';
import { ToastProvider } from './components/ToastProvider';
import './index.css';

import UpgradeModal from './components/UpgradeModal';

function App() {
  const { token, connectSocket, init } = useStore();
  const [currentPage, setCurrentPage] = useState('trading'); // 'trading' or 'investment'
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  useEffect(() => {
    init(); // Restore user from token
    if (token) connectSocket();
  }, [token, connectSocket, init]);

  // Listen for page navigation events
  useEffect(() => {
    const handleNavigate = (e) => setCurrentPage(e.detail.page);
    window.addEventListener('navigate', handleNavigate);

    // Global listener for upgrade modal
    const handleShowUpgrade = () => setShowUpgradeModal(true);
    window.addEventListener('showUpgradeModal', handleShowUpgrade);

    return () => {
      window.removeEventListener('navigate', handleNavigate);
      window.removeEventListener('showUpgradeModal', handleShowUpgrade);
    };
  }, []);

  if (!token) return <Login />;

  return (
    <ToastProvider>
      <div className="app-container">
        <Navbar currentPage={currentPage} onNavigate={setCurrentPage} />

        {currentPage === 'trading' ? (
          <div className="main-content">
            {/* Left Toolbar */}
            <LeftToolbar />

            {/* Main Chart Area - Now with 4 charts */}
            <div className="chart-area">
              <TradingDashboard />
            </div>

            {/* Right Sidebar */}
            <Sidebar />
          </div>
        ) : (
          <div className="full-page-content">
            <InvestmentSimulator />
          </div>
        )}

        {showUpgradeModal && <UpgradeModal onClose={() => setShowUpgradeModal(false)} />}
      </div>
    </ToastProvider>
  );
}

export default App;

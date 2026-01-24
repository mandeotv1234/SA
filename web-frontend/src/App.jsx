import React, { useEffect } from 'react';
import useStore from './store';
import Login from './components/Login.jsx';
import TradingDashboard from './components/TradingDashboard';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import LeftToolbar from './components/LeftToolbar';
import './index.css';

function App() {
  const { token, connectSocket, init } = useStore();

  useEffect(() => {
    init(); // Restore user from token
    if (token) connectSocket();
  }, [token, connectSocket, init]);

  if (!token) return <Login />;

  return (
    <div className="app-container">
      <Navbar />

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
    </div>
  );
}

export default App;

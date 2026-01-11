import React, { useEffect } from 'react';
import useStore from './store';
import Login from './components/Login.jsx';
import Chart from './components/Chart';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import LeftToolbar from './components/LeftToolbar';
import './index.css';

function App() {
  const { token, connectSocket } = useStore();

  useEffect(() => {
    if (token) connectSocket();
  }, [token, connectSocket]);

  if (!token) return <Login />;

  return (
    <div className="app-container">
      <Navbar />

      <div className="main-content">
        {/* Left Toolbar */}
        <LeftToolbar />

        {/* Main Chart Area */}
        <div className="chart-area">
          <Chart />
        </div>

        {/* Right Sidebar */}
        <Sidebar />
      </div>
    </div>
  );
}

export default App;

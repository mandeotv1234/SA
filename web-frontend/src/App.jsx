import React from 'react';
import Chart from './components/Chart';
import useStore from './store';
import Login from './components/Login.jsx';
import InsightsPanel from './components/InsightsPanel';

function App() {
  const { price, connectSocket, token, authFetch } = useStore();

  React.useEffect(() => { connectSocket(); }, [connectSocket]);

  // Debug: try fetch history once and show result count
  const [historyCount, setHistoryCount] = React.useState(null);
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await authFetch('/v1/klines?symbol=BTCUSDT&limit=1000');
        if (!res.ok) throw new Error('history fetch failed ' + res.status);
        const data = await res.json();
        if (mounted) setHistoryCount(Array.isArray(data) ? data.length : -1);
      } catch (e) {
        if (mounted) setHistoryCount(-1);
        console.error('history fetch err', e);
      }
    })();
    return () => { mounted = false; };
  }, [authFetch]);

  // if not authenticated show login page
  if (!token) return <Login />;

  return (
    <div style={{ padding: 12 }}>
      <h1>Crypto Dashboard</h1>

      <section style={{ marginBottom: 12 }}>
        <div>Last price event: {price ? JSON.stringify(price) : 'none'}</div>
      </section>

      <Chart price={price} />

      <InsightsPanel authFetch={authFetch} />
    </div>
  );
}

export default App;
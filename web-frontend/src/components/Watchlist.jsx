import { useState, useEffect } from 'react';
import useStore from '../store';
import { Search } from 'lucide-react';
import { io } from 'socket.io-client';

const TIMEFRAMES = [
    { label: '1 phút', value: '1m', seconds: 60 },
    { label: '5 phút', value: '5m', seconds: 300 },
    { label: '15 phút', value: '15m', seconds: 900 },
    { label: '1 giờ', value: '1h', seconds: 3600 },
    { label: '4 giờ', value: '4h', seconds: 14400 },
    { label: '1 ngày', value: '1d', seconds: 86400 },
    { label: '1 tuần', value: '1w', seconds: 604800 }
];

export default function Watchlist() {
    const { token, supportedSymbols, currentSymbol, setSymbol, authFetch } = useStore();
    const [search, setSearch] = useState('');
    const [selectedTimeframe, setSelectedTimeframe] = useState('1m');
    const [oldPrices, setOldPrices] = useState({}); // Giá X thời gian trước
    const [currentPrices, setCurrentPrices] = useState({});

    // Fetch old prices when timeframe changes
    useEffect(() => {
        if (!token || supportedSymbols.length === 0) return;

        const fetchOldPrices = async () => {
            const timeframe = TIMEFRAMES.find(tf => tf.value === selectedTimeframe);
            if (!timeframe) return;

            // Choose appropriate interval based on timeframe to ensure data exists (backfill limitations)
            let fetchInterval = '1m';
            if (['1d', '1w'].includes(selectedTimeframe)) fetchInterval = '1h';
            else if (['4h', '1h'].includes(selectedTimeframe)) fetchInterval = '5m';

            const now = Math.floor(Date.now() / 1000);
            const oldTime = now - timeframe.seconds;

            const prices = {};

            // Fetch old price for each symbol
            for (const symbol of supportedSymbols) {
                try {
                    const url = `/v1/klines?symbol=${symbol}&limit=1&interval=${fetchInterval}&end=${oldTime}`;
                    const res = await authFetch(url);
                    if (res.ok) {
                        const data = await res.json();
                        if (data && data.length > 0) {
                            // Use close price of the candle nearest to oldTime
                            prices[symbol] = parseFloat(data[0].close);
                        }
                    }
                } catch (e) {
                    console.error(`[Watchlist] Failed to fetch old price for ${symbol}:`, e);
                }
            }

            setOldPrices(prices);
            console.log(`[Watchlist] Fetched old prices for ${selectedTimeframe} (int: ${fetchInterval}):`, prices);
        };

        fetchOldPrices();

        // Refresh old prices every minute
        const interval = setInterval(fetchOldPrices, 60000);

        return () => clearInterval(interval);
    }, [selectedTimeframe, token, supportedSymbols, authFetch]);

    // WebSocket connection for real-time prices
    useEffect(() => {
        if (!token) return;

        const wsBase = import.meta.env.VITE_WS_URL || 'http://localhost:8000';
        const socketUrl = `${wsBase}?token=${encodeURIComponent(token)}`;

        const socket = io(socketUrl, {
            path: '/stream-api/socket.io',
            transports: ['websocket'],
            reconnectionDelay: 1000,
            reconnectionAttempts: 10
        });

        socket.on('connect', () => {
            console.log('[Watchlist] WebSocket connected');
            // Subscribe to all symbols
            supportedSymbols.forEach(symbol => {
                socket.emit('subscribe', symbol);
            });
        });

        socket.on('price_event', (msg) => {
            if (msg && msg.symbol && msg.kline) {
                const symbol = msg.symbol.toUpperCase();
                const price = parseFloat(msg.kline.c || msg.kline.close);

                // Update current price
                setCurrentPrices(prev => ({
                    ...prev,
                    [symbol]: price
                }));
            }
        });

        socket.on('disconnect', () => {
            console.log('[Watchlist] WebSocket disconnected');
        });

        return () => {
            supportedSymbols.forEach(symbol => {
                socket.emit('unsubscribe', symbol);
            });
            socket.disconnect();
        };
    }, [token, supportedSymbols]);

    const filtered = supportedSymbols.filter(s => s.includes(search.toUpperCase()));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Search Header */}
            <div style={{ padding: 12, borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Search size={14} style={{ color: 'var(--text-secondary)' }} />
                <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search symbol..."
                    style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', width: '100%', fontSize: 13 }}
                />
            </div>

            {/* Timeframe Selector */}
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>% Thay đổi:</span>
                <select
                    value={selectedTimeframe}
                    onChange={e => setSelectedTimeframe(e.target.value)}
                    style={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 4,
                        color: 'var(--text-primary)',
                        fontSize: 11,
                        padding: '4px 24px 4px 8px',
                        cursor: 'pointer',
                        outline: 'none',
                        flex: 1,
                        appearance: 'none',
                        backgroundImage: 'url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3e%3cpolyline points=\'6 9 12 15 18 9\'%3e%3c/polyline%3e%3c/svg%3e")',
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'right 4px center',
                        backgroundSize: '16px'
                    }}
                >
                    {TIMEFRAMES.map(tf => (
                        <option key={tf.value} value={tf.value}>{tf.label}</option>
                    ))}
                </select>
            </div>

            {/* List */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
                {filtered.map(symbol => {
                    const currentPrice = currentPrices[symbol];
                    const oldPrice = oldPrices[symbol];

                    // Calculate % change
                    let change = null;
                    if (currentPrice && oldPrice && oldPrice !== currentPrice) {
                        change = ((currentPrice - oldPrice) / oldPrice) * 100;
                    }

                    const isUp = change !== null && change >= 0;
                    const isSelected = symbol === currentSymbol;

                    return (
                        <div
                            key={symbol}
                            onClick={() => setSymbol(symbol)}
                            style={{
                                padding: '8px 12px',
                                borderBottom: '1px solid var(--border-color)',
                                cursor: 'pointer',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                backgroundColor: isSelected ? 'var(--bg-hover)' : 'transparent'
                            }}
                            className="watchlist-item"
                        >
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontSize: 13, fontWeight: 'bold' }}>{symbol.replace('USDT', '')}</span>
                                <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>USDT</span>
                            </div>
                            {currentPrice ? (
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: 13, fontFamily: 'monospace' }}>
                                        {currentPrice.toFixed(currentPrice < 10 ? 4 : 2)}
                                    </div>
                                    {change !== null ? (
                                        <div style={{
                                            fontSize: 11,
                                            fontWeight: 'bold',
                                            color: isUp ? '#26a69a' : '#ef5350',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'flex-end',
                                            gap: 2
                                        }}>
                                            {isUp ? '▲' : '▼'}
                                            {Math.abs(change).toFixed(2)}%
                                        </div>
                                    ) : (
                                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                            --
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>...</span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

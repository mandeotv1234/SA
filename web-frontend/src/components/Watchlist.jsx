import { useState, useEffect } from 'react';
import useStore from '../store';
import { Search, ChevronDown } from 'lucide-react';
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
    const { token, supportedSymbols, currentSymbol, setSymbol } = useStore();
    const [search, setSearch] = useState('');
    const [selectedTimeframe, setSelectedTimeframe] = useState('1m');
    const [priceSnapshot, setPriceSnapshot] = useState({});
    const [currentPrices, setCurrentPrices] = useState({});

    // WebSocket connection for real-time prices
    useEffect(() => {
        if (!token) return;

        const wsBase = import.meta.env.VITE_WS_URL || 'http://localhost:8000';
        const socketUrl = `${wsBase}?token=${encodeURIComponent(token)}`;

        const socket = io(socketUrl, {
            path: '/socket.io',
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

    // Take price snapshot based on selected timeframe for % calculation
    useEffect(() => {
        const timeframe = TIMEFRAMES.find(tf => tf.value === selectedTimeframe);
        const intervalMs = timeframe ? timeframe.seconds * 1000 : 60000;

        const takeSnapshot = () => {
            if (Object.keys(currentPrices).length > 0) {
                setPriceSnapshot({ ...currentPrices });
                console.log(`[Watchlist] Price snapshot taken (${selectedTimeframe}):`, currentPrices);
            }
        };

        // Take snapshot immediately if we have prices
        if (Object.keys(currentPrices).length > 0 && Object.keys(priceSnapshot).length === 0) {
            takeSnapshot();
        }

        // Then at the selected interval
        const interval = setInterval(takeSnapshot, intervalMs);

        return () => clearInterval(interval);
    }, [currentPrices, priceSnapshot, selectedTimeframe]);

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
                    onChange={e => {
                        setSelectedTimeframe(e.target.value);
                        // Reset snapshot when changing timeframe
                        setPriceSnapshot({});
                    }}
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
                    const oldPrice = priceSnapshot[symbol];
                    
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
                                            0.00%
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

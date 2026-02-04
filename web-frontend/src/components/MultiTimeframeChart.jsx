import React, { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import useStore from '../store';
import { io } from 'socket.io-client';
import { LoadingSpinner } from './LoadingSpinner';
import { useTheme } from './ThemeProvider';

export default function MultiTimeframeChart({ symbol, timeframe, chartId }) {
    const chartContainerRef = useRef();
    const chartRef = useRef();
    const candleSeriesRef = useRef();
    const volumeSeriesRef = useRef();
    const socketRef = useRef(null);
    const loadingBoolRef = useRef(false);
    const oldestTimeRef = useRef(null);
    const latestTimeRef = useRef(null); // Track latest timestamp for realtime updates

    const { authFetch } = useStore();
    const { isDark } = useTheme();
    const [data, setData] = useState([]);
    const [isLoading, setIsLoading] = useState(false); // UI loading state

    // Initialize Chart - recreate when theme changes
    useEffect(() => {
        if (!chartContainerRef.current) return;

        chartContainerRef.current.innerHTML = '';

        // Theme-aware colors
        const chartColors = isDark ? {
            background: '#131722',
            textColor: '#d1d4dc',
            gridColor: 'rgba(42, 46, 57, 0.2)',
            borderColor: '#2B2B43'
        } : {
            background: '#ffffff',
            textColor: '#333333',
            gridColor: 'rgba(0, 0, 0, 0.1)',
            borderColor: '#e0e0e0'
        };

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: 'solid', color: chartColors.background },
                textColor: chartColors.textColor,
            },
            grid: {
                vertLines: { color: chartColors.gridColor },
                horzLines: { color: chartColors.gridColor },
            },
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: chartColors.borderColor,
            },
            rightPriceScale: {
                borderColor: chartColors.borderColor,
            },
        });

        const candlestickSeries = chart.addCandlestickSeries({
            upColor: '#089981',
            downColor: '#f23645',
            borderVisible: false,
            wickUpColor: '#089981',
            wickDownColor: '#f23645',
        });

        const volumeSeries = chart.addHistogramSeries({
            priceFormat: { type: 'volume' },
            priceScaleId: '',
        });

        chart.priceScale('').applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 },
        });

        chartRef.current = chart;
        candleSeriesRef.current = candlestickSeries;
        volumeSeriesRef.current = volumeSeries;

        // Subscribe to visible range changes for infinite scroll
        chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
            if (range && range.from < 0 && !loadingBoolRef.current && oldestTimeRef.current) {
                loadHistory(oldestTimeRef.current);
            }
        });

        const handleResize = () => {
            if (chartRef.current && chartContainerRef.current) {
                chartRef.current.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                    height: chartContainerRef.current.clientHeight
                });
            }
        };

        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
            chart.remove();
        };
    }, [chartId, isDark]); // Recreate chart when theme changes


    // Load Historical Data with infinite scroll support
    const loadHistory = async (endTimeUI = null, showLoading = false) => {
        if (loadingBoolRef.current) return;
        loadingBoolRef.current = true;
        if (showLoading) setIsLoading(true);

        try {
            const url = `/v1/klines?symbol=${symbol}&limit=1000&interval=${timeframe}${endTimeUI ? `&end=${endTimeUI}` : ''}`;
            const res = await authFetch(url);
            if (res.ok) {
                const raw = await res.json();
                if (raw.length === 0) {
                    loadingBoolRef.current = false;
                    setIsLoading(false);
                    return;
                }

                const formatted = raw
                    .map(k => {
                        let t;
                        if (k.time && typeof k.time === 'number') {
                            t = k.time;
                        } else {
                            const rawTime = k.open_time || k[0];
                            t = Math.floor(new Date(rawTime).getTime() / 1000);
                        }

                        return {
                            time: t,
                            open: parseFloat(k.open),
                            high: parseFloat(k.high),
                            low: parseFloat(k.low),
                            close: parseFloat(k.close),
                            value: parseFloat(k.value || k.volume || 0),
                            color: parseFloat(k.close) >= parseFloat(k.open)
                                ? 'rgba(8, 153, 129, 0.5)'
                                : 'rgba(242, 54, 69, 0.5)'
                        };
                    })
                    .filter(k => !isNaN(k.time))
                    .sort((a, b) => a.time - b.time);

                setData(prev => {
                    const combined = [...formatted, ...prev];
                    const unique = [];
                    const seen = new Set();
                    for (let c of combined) {
                        if (!seen.has(c.time)) {
                            seen.add(c.time);
                            unique.push(c);
                        }
                    }
                    return unique.sort((a, b) => a.time - b.time);
                });
            }
        } catch (e) {
            console.error(`[${chartId}] Fetch history failed`, e);
        } finally {
            loadingBoolRef.current = false;
            setIsLoading(false);
        }
    };

    // Reload when symbol or timeframe changes
    useEffect(() => {
        setData([]);
        oldestTimeRef.current = null;
        latestTimeRef.current = null; // Reset latest time
        loadHistory(null, true); // Show loading spinner on symbol/timeframe change
    }, [symbol, timeframe]);

    // Update Chart Data - also run when theme changes to reapply data to new chart
    useEffect(() => {
        if (candleSeriesRef.current && volumeSeriesRef.current && data.length > 0) {
            candleSeriesRef.current.setData(data);
            volumeSeriesRef.current.setData(data.map(d => ({
                time: d.time,
                value: d.value,
                color: d.color
            })));

            // Update oldest time for infinite scroll
            if (oldestTimeRef.current === null || data[0].time < oldestTimeRef.current) {
                oldestTimeRef.current = data[0].time;
            }

            // Update latest time for realtime updates
            latestTimeRef.current = data[data.length - 1].time;
        }
    }, [data, isDark]); // Include isDark to reapply data when theme changes and chart is recreated

    // Socket.IO for Realtime Updates (all timeframes)
    useEffect(() => {
        if (socketRef.current) {
            socketRef.current.disconnect();
        }

        // Get token from store
        const token = useStore.getState().token;
        if (!token) {
            console.warn(`[${chartId}] No token available, skipping Socket.IO connection`);
            return;
        }

        // Connect to Socket.IO gateway via Kong with JWT token
        const socket = io('http://localhost:8000', {
            path: '/stream-api/socket.io',
            transports: ['websocket'],
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionAttempts: 10,
            query: {
                token: token  // Send JWT token for Kong authentication
            }
        });

        socket.on('connect', () => {
            console.log(`[${chartId}] ✅ Socket.IO connected! Socket ID: ${socket.id}`);
            console.log(`[${chartId}] Current symbol: ${symbol}, timeframe: ${timeframe}`);

            // Subscribe to interval-specific room
            // IMPORTANT: Server uppercases the entire room name, so we need to match that
            const room = `${symbol}_${timeframe}`.toUpperCase();
            console.log(`[${chartId}] 📡 Emitting 'subscribe' event for room: ${room}`);
            socket.emit('subscribe', room);

            // Verify subscription after a short delay
            setTimeout(() => {
                console.log(`[${chartId}] ✓ Subscription should be complete for room: ${room}`);
            }, 500);
        });

        socket.on('price_event', (payload) => {
            console.log(`[${chartId}] Received price_event:`, payload);

            // payload format: { symbol: 'BTCUSDT', interval: '1m' or '1M', kline: {...} }
            // Normalize intervals to uppercase for comparison (1m vs 1M)
            const payloadInterval = (payload.interval || '').toUpperCase();
            const expectedInterval = timeframe.toUpperCase();

            if (payload.symbol === symbol && payloadInterval === expectedInterval && payload.kline) {
                const kline = payload.kline;
                const t = Math.floor(kline.openTime / 1000);

                // Only update if this is newer or equal to the latest data we have
                // This prevents "Cannot update oldest data" error from backfill data
                if (latestTimeRef.current !== null && t < latestTimeRef.current) {
                    console.log(`[${chartId}] Skipping old kline: ${t} < ${latestTimeRef.current} (backfill data)`);
                    return;
                }

                console.log(`[${chartId}] Updating chart with kline at time ${t}`);

                const candle = {
                    time: t,
                    open: parseFloat(kline.open),
                    high: parseFloat(kline.high),
                    low: parseFloat(kline.low),
                    close: parseFloat(kline.close),
                };

                const volume = {
                    time: t,
                    value: parseFloat(kline.volume),
                    color: parseFloat(kline.close) >= parseFloat(kline.open)
                        ? 'rgba(8, 153, 129, 0.5)'
                        : 'rgba(242, 54, 69, 0.5)'
                };

                if (candleSeriesRef.current && volumeSeriesRef.current) {
                    try {
                        candleSeriesRef.current.update(candle);
                        volumeSeriesRef.current.update(volume);
                    } catch (error) {
                        console.error(`[${chartId}] Error updating chart:`, error);
                    }
                }
            } else {
                console.log(`[${chartId}] Ignoring price_event - symbol: ${payload.symbol}, interval: ${payloadInterval}, expected: ${symbol}_${expectedInterval}`);
            }
        });

        socket.on('disconnect', () => {
            console.log(`[${chartId}] Socket.IO disconnected`);
        });

        socket.on('connect_error', (err) => {
            console.error(`[${chartId}] Socket.IO connection error:`, err);
        });

        socketRef.current = socket;

        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
        };
    }, [symbol, timeframe, chartId]);

    return (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <div
                ref={chartContainerRef}
                style={{ width: '100%', height: '100%' }}
            />
            {/* Loading Overlay */}
            {isLoading && (
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0, 0, 0, 0.6)',
                    backdropFilter: 'blur(2px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10,
                    animation: 'fadeIn 0.2s ease-out'
                }}>
                    <LoadingSpinner size="md" text="Đang tải..." />
                </div>
            )}
        </div>
    );
}


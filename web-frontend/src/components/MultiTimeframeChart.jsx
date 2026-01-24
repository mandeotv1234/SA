import React, { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import useStore from '../store';
import { io } from 'socket.io-client';

export default function MultiTimeframeChart({ symbol, timeframe, chartId }) {
    const chartContainerRef = useRef();
    const chartRef = useRef();
    const candleSeriesRef = useRef();
    const volumeSeriesRef = useRef();
    const socketRef = useRef(null);
    const loadingRef = useRef(false);
    const oldestTimeRef = useRef(null);
    const latestTimeRef = useRef(null); // Track latest timestamp for realtime updates

    const { authFetch } = useStore();
    const [data, setData] = useState([]);

    // Initialize Chart
    useEffect(() => {
        if (!chartContainerRef.current) return;

        chartContainerRef.current.innerHTML = '';

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: 'solid', color: '#131722' },
                textColor: '#d1d4dc',
            },
            grid: {
                vertLines: { color: 'rgba(42, 46, 57, 0.2)' },
                horzLines: { color: 'rgba(42, 46, 57, 0.2)' },
            },
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
            },
            rightPriceScale: {
                borderColor: '#2B2B43',
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
            if (range && range.from < 0 && !loadingRef.current && oldestTimeRef.current) {
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
    }, [chartId]);

    // Load Historical Data with infinite scroll support
    const loadHistory = async (endTimeUI = null) => {
        if (loadingRef.current) return;
        loadingRef.current = true;

        try {
            const url = `/v1/klines?symbol=${symbol}&limit=1000&interval=${timeframe}${endTimeUI ? `&end=${endTimeUI}` : ''}`;
            const res = await authFetch(url);
            if (res.ok) {
                const raw = await res.json();
                if (raw.length === 0) {
                    loadingRef.current = false;
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
            loadingRef.current = false;
        }
    };

    // Reload when symbol or timeframe changes
    useEffect(() => {
        setData([]);
        oldestTimeRef.current = null;
        latestTimeRef.current = null; // Reset latest time
        loadHistory(null);
    }, [symbol, timeframe]);

    // Update Chart Data
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
    }, [data]);

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
        <div
            ref={chartContainerRef}
            style={{ width: '100%', height: '100%', position: 'relative' }}
        />
    );
}

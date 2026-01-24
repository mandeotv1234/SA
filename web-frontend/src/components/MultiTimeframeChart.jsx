import React, { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import useStore from '../store';

export default function MultiTimeframeChart({ symbol, timeframe, chartId }) {
    const chartContainerRef = useRef();
    const chartRef = useRef();
    const candleSeriesRef = useRef();
    const volumeSeriesRef = useRef();
    const wsRef = useRef(null);
    const loadingRef = useRef(false);
    const oldestTimeRef = useRef(null);

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
            if (wsRef.current) wsRef.current.close();
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
        }
    }, [data]);

    // WebSocket for Realtime Updates (only for 1m timeframe)
    useEffect(() => {
        if (timeframe !== '1m') return; // Chỉ realtime cho 1m

        if (wsRef.current) wsRef.current.close();

        const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${timeframe}`);

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.k) {
                const kline = msg.k;
                const t = Math.floor(kline.t / 1000);

                const candle = {
                    time: t,
                    open: parseFloat(kline.o),
                    high: parseFloat(kline.h),
                    low: parseFloat(kline.l),
                    close: parseFloat(kline.c),
                };

                const volume = {
                    time: t,
                    value: parseFloat(kline.v),
                    color: parseFloat(kline.c) >= parseFloat(kline.o)
                        ? 'rgba(8, 153, 129, 0.5)'
                        : 'rgba(242, 54, 69, 0.5)'
                };

                if (candleSeriesRef.current && volumeSeriesRef.current) {
                    candleSeriesRef.current.update(candle);
                    volumeSeriesRef.current.update(volume);
                }
            }
        };

        ws.onerror = (err) => console.error(`[${chartId}] WebSocket error:`, err);
        wsRef.current = ws;

        return () => {
            if (wsRef.current) wsRef.current.close();
        };
    }, [symbol, timeframe, chartId]);

    return (
        <div
            ref={chartContainerRef}
            style={{ width: '100%', height: '100%', position: 'relative' }}
        />
    );
}

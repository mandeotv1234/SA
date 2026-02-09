import React, { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import useStore from '../store';
import { calculateSMA, calculateEMA, calculateBollingerBands, calculateRSI, calculateMACD } from '../utils/technicalIndicators';

export default function AdvancedChart() {
    const chartContainerRef = useRef();
    const legendRef = useRef();
    const chartRef = useRef();
    const candleSeriesRef = useRef();
    const volumeSeriesRef = useRef();

    // Technical Indicators Series
    const sma20SeriesRef = useRef();
    const ema12SeriesRef = useRef();
    const ema26SeriesRef = useRef();
    const bbUpperSeriesRef = useRef();
    const bbMiddleSeriesRef = useRef();
    const bbLowerSeriesRef = useRef();

    // RSI and MACD Series
    const rsiSeriesRef = useRef();
    const macdLineSeriesRef = useRef();
    const macdSignalSeriesRef = useRef();
    const macdHistogramSeriesRef = useRef();

    // News markers
    const newsMarkersRef = useRef([]);

    const { currentSymbol, price, authFetch } = useStore();
    const [data, setData] = useState([]);
    const [newsData, setNewsData] = useState([]);
    const [timeOffset, setTimeOffset] = useState(0);

    // Indicator visibility toggles
    const [indicators, setIndicators] = useState({
        sma20: true,
        ema12: true,
        ema26: true,
        bb: false,
        rsi: false,
        macd: false
    });

    const loadingRef = useRef(false);
    const oldestTimeRef = useRef(null);
    const timeOffsetRef = useRef(0);

    useEffect(() => {
        timeOffsetRef.current = timeOffset;
    }, [timeOffset]);

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
                vertLines: { color: 'rgba(42, 46, 57, 0.2)', style: 1, visible: true },
                horzLines: { color: 'rgba(42, 46, 57, 0.2)', style: 1, visible: true },
            },
            crosshair: {
                mode: 1,
            },
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                barSpacing: 10,
                minBarSpacing: 3,
                borderColor: '#2B2B43',
            },
            rightPriceScale: {
                borderColor: '#2B2B43',
            },
        });

        // Candlestick Series
        const candlestickSeries = chart.addCandlestickSeries({
            upColor: '#089981',
            downColor: '#f23645',
            borderVisible: false,
            wickUpColor: '#089981',
            wickDownColor: '#f23645',
        });

        // Volume Series
        const volumeSeries = chart.addHistogramSeries({
            priceFormat: {
                type: 'volume',
            },
            priceScaleId: '',
        });

        chart.priceScale('').applyOptions({
            scaleMargins: {
                top: 0.8,
                bottom: 0,
            },
        });

        // Technical Indicators
        const sma20Series = chart.addLineSeries({
            color: '#2962FF',
            lineWidth: 2,
            title: 'SMA 20',
            visible: indicators.sma20
        });

        const ema12Series = chart.addLineSeries({
            color: '#FF6D00',
            lineWidth: 2,
            title: 'EMA 12',
            visible: indicators.ema12
        });

        const ema26Series = chart.addLineSeries({
            color: '#9C27B0',
            lineWidth: 2,
            title: 'EMA 26',
            visible: indicators.ema26
        });

        // Bollinger Bands
        const bbUpperSeries = chart.addLineSeries({
            color: 'rgba(33, 150, 243, 0.5)',
            lineWidth: 1,
            title: 'BB Upper',
            visible: indicators.bb
        });

        const bbMiddleSeries = chart.addLineSeries({
            color: 'rgba(33, 150, 243, 0.8)',
            lineWidth: 1,
            lineStyle: 2, // Dashed
            title: 'BB Middle',
            visible: indicators.bb
        });

        const bbLowerSeries = chart.addLineSeries({
            color: 'rgba(33, 150, 243, 0.5)',
            lineWidth: 1,
            title: 'BB Lower',
            visible: indicators.bb
        });

        // RSI (Relative Strength Index) - separate scale
        const rsiSeries = chart.addLineSeries({
            color: '#FF9800',
            lineWidth: 2,
            title: 'RSI',
            visible: indicators.rsi,
            priceScaleId: 'rsi',
            priceFormat: {
                type: 'price',
                precision: 2,
                minMove: 0.01,
            }
        });

        // Configure RSI scale (0-100)
        chart.priceScale('rsi').applyOptions({
            scaleMargins: {
                top: 0.85,
                bottom: 0,
            },
            borderColor: '#2B2B43',
        });

        // MACD - separate scale (render histogram first, then lines on top)
        const macdHistogramSeries = chart.addHistogramSeries({
            title: 'MACD Histogram',
            visible: indicators.macd,
            priceScaleId: 'macd',
            priceFormat: {
                type: 'price',
                precision: 2,
            },
            lastValueVisible: false
        });

        const macdLineSeries = chart.addLineSeries({
            color: '#00BCD4',  // Cyan for MACD line - very distinct
            lineWidth: 3,      // Thicker line
            title: 'MACD',
            visible: indicators.macd,
            priceScaleId: 'macd',
            lastValueVisible: true,
            priceLineVisible: false
        });

        const macdSignalSeries = chart.addLineSeries({
            color: '#FF9800',  // Orange for Signal line - very distinct
            lineWidth: 3,      // Thicker line
            title: 'Signal',
            visible: indicators.macd,
            priceScaleId: 'macd',
            lastValueVisible: true,
            priceLineVisible: false
        });

        // Configure MACD scale
        chart.priceScale('macd').applyOptions({
            scaleMargins: {
                top: 0.9,
                bottom: 0,
            },
            borderColor: '#2B2B43',
        });

        chartRef.current = chart;
        candleSeriesRef.current = candlestickSeries;
        volumeSeriesRef.current = volumeSeries;
        sma20SeriesRef.current = sma20Series;
        ema12SeriesRef.current = ema12Series;
        ema26SeriesRef.current = ema26Series;
        bbUpperSeriesRef.current = bbUpperSeries;
        bbMiddleSeriesRef.current = bbMiddleSeries;
        bbLowerSeriesRef.current = bbLowerSeries;
        rsiSeriesRef.current = rsiSeries;
        macdLineSeriesRef.current = macdLineSeries;
        macdSignalSeriesRef.current = macdSignalSeries;
        macdHistogramSeriesRef.current = macdHistogramSeries;

        // Crosshair move event
        chart.subscribeCrosshairMove(param => {
            if (!legendRef.current) return;
            const candleData = param.seriesData.get(candlestickSeries);
            const volumeData = param.seriesData.get(volumeSeries);

            if (candleData) {
                const { open, high, low, close } = candleData;
                const color = close >= open ? '#089981' : '#f23645';
                const vol = volumeData ? volumeData.value : 0;

                // Get indicator values at crosshair position
                const sma20Data = param.seriesData.get(sma20Series);
                const ema12Data = param.seriesData.get(ema12Series);
                const ema26Data = param.seriesData.get(ema26Series);

                let indicatorHTML = '';
                if (sma20Data && indicators.sma20) {
                    indicatorHTML += `<span style="color: #2962FF">SMA20: ${sma20Data.value.toFixed(2)}</span> `;
                }
                if (ema12Data && indicators.ema12) {
                    indicatorHTML += `<span style="color: #FF6D00">EMA12: ${ema12Data.value.toFixed(2)}</span> `;
                }
                if (ema26Data && indicators.ema26) {
                    indicatorHTML += `<span style="color: #9C27B0">EMA26: ${ema26Data.value.toFixed(2)}</span>`;
                }

                legendRef.current.innerHTML = `
          <div style="font-size: 16px; font-weight: bold; margin-bottom: 4px;">${currentSymbol}</div>
          <div style="display: flex; gap: 12px; font-size: 12px; font-family: monospace; margin-bottom: 4px;">
            <span style="color: ${color}">O: ${open.toFixed(2)}</span>
            <span style="color: ${color}">H: ${high.toFixed(2)}</span>
            <span style="color: ${color}">L: ${low.toFixed(2)}</span>
            <span style="color: ${color}">C: ${close.toFixed(2)}</span>
            <span style="color: #787b86">V: ${vol.toFixed(2)}</span>
          </div>
          <div style="font-size: 11px; font-family: monospace;">
            ${indicatorHTML}
          </div>
        `;
            }
        });

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
            chart.remove();
        };
    }, [currentSymbol]);

    // Update indicator visibility
    useEffect(() => {
        if (sma20SeriesRef.current) {
            sma20SeriesRef.current.applyOptions({ visible: indicators.sma20 });
        }
        if (ema12SeriesRef.current) {
            ema12SeriesRef.current.applyOptions({ visible: indicators.ema12 });
        }
        if (ema26SeriesRef.current) {
            ema26SeriesRef.current.applyOptions({ visible: indicators.ema26 });
        }
        if (bbUpperSeriesRef.current && bbMiddleSeriesRef.current && bbLowerSeriesRef.current) {
            bbUpperSeriesRef.current.applyOptions({ visible: indicators.bb });
            bbMiddleSeriesRef.current.applyOptions({ visible: indicators.bb });
            bbLowerSeriesRef.current.applyOptions({ visible: indicators.bb });
        }
        if (rsiSeriesRef.current) {
            rsiSeriesRef.current.applyOptions({ visible: indicators.rsi });
        }
        if (macdLineSeriesRef.current && macdSignalSeriesRef.current && macdHistogramSeriesRef.current) {
            macdLineSeriesRef.current.applyOptions({ visible: indicators.macd });
            macdSignalSeriesRef.current.applyOptions({ visible: indicators.macd });
            macdHistogramSeriesRef.current.applyOptions({ visible: indicators.macd });
        }
    }, [indicators]);

    const loadHistory = async (endTimeUI = null) => {
        if (loadingRef.current) return;
        loadingRef.current = true;

        try {
            const url = `/v1/klines?symbol=${currentSymbol}&limit=1000&interval=1m${endTimeUI ? `&end=${endTimeUI}` : ''}`;
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
                            color: parseFloat(k.close) >= parseFloat(k.open) ? 'rgba(8, 153, 129, 0.5)' : 'rgba(242, 54, 69, 0.5)'
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
            console.error("Fetch history failed", e);
        } finally {
            loadingRef.current = false;
        }
    };

    // Load news data
    const loadNews = async () => {
        try {
            // Get time range from current data
            if (data.length === 0) return;

            const startTime = new Date(data[0].time * 1000).toISOString();
            const endTime = new Date(data[data.length - 1].time * 1000).toISOString();

            const url = `/v1/news?start=${startTime}&end=${endTime}&limit=100`;
            const res = await authFetch(url);

            if (res.ok) {
                const newsResponse = await res.json();
                setNewsData(newsResponse.rows || []);
            }
        } catch (e) {
            console.error("Fetch news failed", e);
        }
    };

    // Initial Load
    useEffect(() => {
        setData([]);
        setTimeOffset(0);
        oldestTimeRef.current = null;
        loadHistory(null);
    }, [currentSymbol]);

    // Load news when data changes
    useEffect(() => {
        if (data.length > 0) {
            loadNews();
        }
    }, [data.length > 0 ? data[0].time : null, data.length > 0 ? data[data.length - 1].time : null]);

    // Sync Data to Chart and Calculate Indicators
    useEffect(() => {
        if (candleSeriesRef.current && volumeSeriesRef.current && data.length > 0) {
            // Set candlestick and volume data
            candleSeriesRef.current.setData(data.map(d => ({ ...d })));
            volumeSeriesRef.current.setData(data.map(d => ({
                time: d.time,
                value: d.value,
                color: d.color
            })));

            // Calculate and set technical indicators
            if (indicators.sma20 && sma20SeriesRef.current) {
                const sma20Data = calculateSMA(data, 20);
                sma20SeriesRef.current.setData(sma20Data);
            }

            if (indicators.ema12 && ema12SeriesRef.current) {
                const ema12Data = calculateEMA(data, 12);
                ema12SeriesRef.current.setData(ema12Data);
            }

            if (indicators.ema26 && ema26SeriesRef.current) {
                const ema26Data = calculateEMA(data, 26);
                ema26SeriesRef.current.setData(ema26Data);
            }

            if (indicators.bb && bbUpperSeriesRef.current && bbMiddleSeriesRef.current && bbLowerSeriesRef.current) {
                const bbData = calculateBollingerBands(data, 20, 2);
                bbUpperSeriesRef.current.setData(bbData.upper);
                bbMiddleSeriesRef.current.setData(bbData.middle);
                bbLowerSeriesRef.current.setData(bbData.lower);
            }

            // Calculate and set RSI
            if (indicators.rsi && rsiSeriesRef.current) {
                const rsiData = calculateRSI(data, 14);
                rsiSeriesRef.current.setData(rsiData);
            }

            // Calculate and set MACD
            if (indicators.macd && macdLineSeriesRef.current && macdSignalSeriesRef.current && macdHistogramSeriesRef.current) {
                const macdData = calculateMACD(data, 12, 26, 9);
                macdLineSeriesRef.current.setData(macdData.macd);
                macdSignalSeriesRef.current.setData(macdData.signal);
                macdHistogramSeriesRef.current.setData(macdData.histogram);
            }

            if (oldestTimeRef.current === null || data[0].time < oldestTimeRef.current) {
                oldestTimeRef.current = data[0].time;
            }
        }
    }, [data, indicators]);

    // Add news markers to chart
    useEffect(() => {
        if (candleSeriesRef.current && newsData.length > 0 && data.length > 0) {
            // Create markers for news events
            const markers = newsData.map(news => {
                const newsTime = Math.floor(new Date(news.time).getTime() / 1000);

                // Determine marker color based on sentiment
                let color = '#2196F3'; // Blue for neutral
                if (news.sentiment_score > 0.3) {
                    color = '#4CAF50'; // Green for positive
                } else if (news.sentiment_score < -0.3) {
                    color = '#F44336'; // Red for negative
                }

                return {
                    time: newsTime,
                    position: 'aboveBar',
                    color: color,
                    shape: 'circle',
                    text: 'N',
                    size: 1,
                    // Store news data for tooltip
                    id: news.url,
                    title: news.title,
                    source: news.source,
                    sentiment: news.sentiment_score
                };
            }).filter(marker => {
                // Only show markers within visible data range
                return marker.time >= data[0].time && marker.time <= data[data.length - 1].time;
            });

            candleSeriesRef.current.setMarkers(markers);
            newsMarkersRef.current = markers;
        }
    }, [newsData, data]);

    // Realtime Updates
    useEffect(() => {
        if (price && candleSeriesRef.current && volumeSeriesRef.current) {
            if (!isNaN(price.t)) {
                candleSeriesRef.current.update({
                    time: price.t,
                    open: price.o,
                    high: price.h,
                    low: price.l,
                    close: price.c
                });

                volumeSeriesRef.current.update({
                    time: price.t,
                    value: price.value || 0,
                    color: price.color
                });
            }
        }
    }, [price]);

    const toggleIndicator = (indicator) => {
        setIndicators(prev => ({
            ...prev,
            [indicator]: !prev[indicator]
        }));
    };

    return (
        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            {/* Legend */}
            <div ref={legendRef}
                style={{
                    position: 'absolute',
                    top: 12,
                    left: 12,
                    zIndex: 20,
                    color: '#d1d4dc',
                    pointerEvents: 'none',
                    backgroundColor: 'rgba(19, 23, 34, 0.6)',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    backdropFilter: 'blur(4px)'
                }}
            >
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{currentSymbol}</div>
            </div>

            {/* Indicator Controls */}
            <div style={{
                position: 'absolute',
                top: 12,
                right: 12,
                zIndex: 20,
                backgroundColor: 'rgba(19, 23, 34, 0.9)',
                padding: '8px 12px',
                borderRadius: '6px',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap'
            }}>
                <button
                    onClick={() => toggleIndicator('sma20')}
                    style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        borderRadius: '4px',
                        border: 'none',
                        cursor: 'pointer',
                        backgroundColor: indicators.sma20 ? '#2962FF' : 'rgba(255, 255, 255, 0.1)',
                        color: '#fff',
                        fontWeight: indicators.sma20 ? 'bold' : 'normal'
                    }}
                >
                    SMA 20
                </button>
                <button
                    onClick={() => toggleIndicator('ema12')}
                    style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        borderRadius: '4px',
                        border: 'none',
                        cursor: 'pointer',
                        backgroundColor: indicators.ema12 ? '#FF6D00' : 'rgba(255, 255, 255, 0.1)',
                        color: '#fff',
                        fontWeight: indicators.ema12 ? 'bold' : 'normal'
                    }}
                >
                    EMA 12
                </button>
                <button
                    onClick={() => toggleIndicator('ema26')}
                    style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        borderRadius: '4px',
                        border: 'none',
                        cursor: 'pointer',
                        backgroundColor: indicators.ema26 ? '#9C27B0' : 'rgba(255, 255, 255, 0.1)',
                        color: '#fff',
                        fontWeight: indicators.ema26 ? 'bold' : 'normal'
                    }}
                >
                    EMA 26
                </button>
                <button
                    onClick={() => toggleIndicator('bb')}
                    style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        borderRadius: '4px',
                        border: 'none',
                        cursor: 'pointer',
                        backgroundColor: indicators.bb ? '#2196F3' : 'rgba(255, 255, 255, 0.1)',
                        color: '#fff',
                        fontWeight: indicators.bb ? 'bold' : 'normal'
                    }}
                >
                    BB
                </button>
                <button
                    onClick={() => toggleIndicator('rsi')}
                    style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        borderRadius: '4px',
                        border: 'none',
                        cursor: 'pointer',
                        backgroundColor: indicators.rsi ? '#FF9800' : 'rgba(255, 255, 255, 0.1)',
                        color: '#fff',
                        fontWeight: indicators.rsi ? 'bold' : 'normal'
                    }}
                >
                    RSI
                </button>
                <button
                    onClick={() => toggleIndicator('macd')}
                    style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        borderRadius: '4px',
                        border: 'none',
                        cursor: 'pointer',
                        backgroundColor: indicators.macd ? '#2196F3' : 'rgba(255, 255, 255, 0.1)',
                        color: '#fff',
                        fontWeight: indicators.macd ? 'bold' : 'normal'
                    }}
                >
                    MACD
                </button>
            </div>

            {/* News Legend */}
            <div style={{
                position: 'absolute',
                bottom: 12,
                left: 12,
                zIndex: 20,
                backgroundColor: 'rgba(19, 23, 34, 0.9)',
                padding: '6px 10px',
                borderRadius: '4px',
                backdropFilter: 'blur(4px)',
                fontSize: '11px',
                color: '#d1d4dc'
            }}>
                {/* <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <span style={{ fontWeight: 'bold' }}>Tin tức:</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#4CAF50' }}></div>
                        <span>Tích cực</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#2196F3' }}></div>
                        <span>Trung lập</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#F44336' }}></div>
                        <span>Tiêu cực</span>
                    </div>
                    <span style={{ marginLeft: '8px', opacity: 0.7 }}>({newsData.length} sự kiện)</span>
                </div> */}
            </div>

            <div ref={chartContainerRef} style={{ width: '100%', height: '100%', position: 'relative', zIndex: 10 }} />
        </div>
    );
}

import React, { useLayoutEffect, useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import useStore from '../store';

/*
 Improvements:
 - infinite/backfill loading when user scrolls to far left (loads older candles)
 - robust in-memory candle buffer to prepend older data and append realtime updates
 - dynamic time axis formatter (year/month vs day/month vs hh:mm) depending on zoom level
 - crosshair tooltip showing time & OHLC
 - better resize handling and UI overlay while loading
*/

function toSeconds(ts) {
  if (typeof ts !== 'number') ts = Number(ts);
  if (!isFinite(ts)) return null;
  if (ts > 1e12) return Math.floor(ts / 1000);
  if (ts > 1e10) return Math.floor(ts / 1000);
  return Math.floor(ts);
}

function formatTimeDynamic(tsSeconds, visibleRange) {
  try {
    const date = new Date(tsSeconds * 1000);
    // visibleRange: { from, to } seconds
    if (!visibleRange) {
      return date.toLocaleString();
    }
    const span = visibleRange.to - visibleRange.from; // seconds
    // span thresholds (seconds)
    if (span <= 3600 * 2) {
      // <2h -> show HH:MM:SS or HH:MM
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (span <= 3600 * 24 * 2) {
      // <2 days -> show dd/MM HH:MM
      return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    if (span <= 3600 * 24 * 365) {
      // <1 year -> show Month Day
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    // >=1 year -> show Year
    return date.toLocaleDateString([], { year: 'numeric', month: 'short' });
  } catch (e) {
    return String(tsSeconds);
  }
}

export default function Chart({ price }) {
  const { authFetch } = useStore();
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const resizeObserverRef = useRef(null);

  // in-memory candle buffer (sorted ascending by time)
  const dataRef = useRef([]);
  const lastTimeRef = useRef(null);
  const visibleRangeRef = useRef(null);
  const isLoadingOlderRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [tooltipState, setTooltipState] = useState(null); // { left, top, text }

  // create chart & series once after layout
  useLayoutEffect(() => {
    if (!containerRef.current) return;

    if (!chartRef.current) {
      const width = containerRef.current.clientWidth || 800;
      chartRef.current = createChart(containerRef.current, {
        width,
        height: 480,
        layout: { backgroundColor: '#0f1724', textColor: '#d1d5db' },
        grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
        rightPriceScale: { borderColor: '#374151' },
        timeScale: { borderColor: '#374151', timeVisible: true, secondsVisible: false },
      });
      seriesRef.current = chartRef.current.addCandlestickSeries({
        upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickVisible: true
      });
    }

    // resize observer
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserverRef.current = new ResizeObserver(() => {
        try {
          if (chartRef.current && containerRef.current) {
            chartRef.current.resize(containerRef.current.clientWidth, 480);
          }
        } catch (e) {}
      });
      resizeObserverRef.current.observe(containerRef.current);
    } else {
      const onResize = () => {
        try {
          if (chartRef.current && containerRef.current) {
            chartRef.current.resize(containerRef.current.clientWidth, 480);
          }
        } catch (e) {}
      };
      window.addEventListener('resize', onResize);
      resizeObserverRef.current = { disconnect: () => window.removeEventListener('resize', onResize) };
    }

    // visible time range change -> keep reference and update time formatter
    const unsubVisible = chartRef.current.timeScale().subscribeVisibleTimeRangeChange((range) => {
      visibleRangeRef.current = range;
      // update localization formatter dynamically
      chartRef.current.applyOptions({
        localization: {
          timeFormatter: (t) => formatTimeDynamic(t, visibleRangeRef.current)
        }
      });

      // if user scrolled very left, request older data
      if (range && range.from) {
        const leftVisible = Math.floor(range.from);
        if (!isLoadingOlderRef.current && dataRef.current.length > 0) {
          const earliest = dataRef.current[0].time;
          // threshold: when left visible within 10 bars from earliest
          const visibleBars = Math.max(5, Math.floor((range.to - range.from) / ((dataRef.current[dataRef.current.length-1]?.time || range.to) - earliest + 1) * dataRef.current.length));
          if (leftVisible <= earliest + Math.max(1, visibleBars*0.5)) {
            // load older
            loadOlder();
          }
        }
      }
    });

    // crosshair tooltip
    const unsubCrosshair = chartRef.current.subscribeCrosshairMove((param) => {
      if (!param || !param.time) {
        setTooltipState(null);
        return;
      }
      const time = typeof param.time === 'number' ? param.time : (param.time || {}).timestamp || null;
      const point = param.point || { x: 0, y: 0 };
      let text = '';
      if (param.seriesPrices && param.seriesPrices.size) {
        // seriesPrices is a Map<series, values>
        for (const [series, values] of param.seriesPrices) {
          if (values && values.value) {
            const v = values.value;
            // values may be object {open, high, low, close}
            if (v.close !== undefined) {
              text = `${formatTimeDynamic(time, visibleRangeRef.current)} — O:${v.open} H:${v.high} L:${v.low} C:${v.close}`;
            } else {
              text = `${formatTimeDynamic(time, visibleRangeRef.current)} — ${v}`;
            }
            break;
          }
        }
      }
      setTooltipState({
        left: point.x,
        top: point.y,
        text
      });
    });

    return () => {
      try { unsubVisible && typeof unsubVisible === 'function' && unsubVisible(); } catch (e) {}
      try { unsubCrosshair && typeof unsubCrosshair === 'function' && unsubCrosshair(); } catch (e) {}
      try { resizeObserverRef.current && typeof resizeObserverRef.current.disconnect === 'function' && resizeObserverRef.current.disconnect(); } catch (e) {}
      try {
        if (chartRef.current && typeof chartRef.current.remove === 'function') chartRef.current.remove();
      } catch (e) {}
      chartRef.current = null;
      seriesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // initial history load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const symbol = 'BTCUSDT';
        const limit = 1000; // load more for deep history on first load
        const path = `/v1/klines?symbol=${symbol}&limit=${limit}`;
        const resp = await authFetch(path);
        if (!resp.ok) throw new Error(`Failed to load klines: ${resp.status}`);
        const data = await resp.json();
        if (cancelled) return;
        const normalized = (Array.isArray(data) ? data : []).map(d => ({
          time: toSeconds(d.time),
          open: +d.open,
          high: +d.high,
          low: +d.low,
          close: +d.close
        })).filter(d => d.time !== null);

        dataRef.current = normalized;
        if (seriesRef.current) seriesRef.current.setData(dataRef.current);
        if (dataRef.current.length) lastTimeRef.current = dataRef.current[dataRef.current.length - 1].time;
        setReady(true);

        // fit content and scroll to end (real-time)
        try {
          chartRef.current.timeScale().fitContent();
          chartRef.current.timeScale().scrollToRealTime();
        } catch (e) {}
      } catch (err) {
        console.error('Failed to fetch historical klines', err);
      }
    })();
    return () => { cancelled = true; };
  }, [authFetch]);

  // function to load older candles and prepend to buffer
  async function loadOlder() {
    if (isLoadingOlderRef.current) return;
    if (!dataRef.current.length) return;
    isLoadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const earliest = dataRef.current[0].time; // seconds
      // request older candles ending before earliest (converted to ms for backend if expected)
      // Use endTime param in ms if backend supports, fall back to endTime in seconds
      const endTimeMs = earliest * 1000 - 1;
      const symbol = 'BTCUSDT';
      const limit = 500;
      const path = `/v1/klines?symbol=${symbol}&limit=${limit}&endTime=${endTimeMs}`;
      const resp = await authFetch(path);
      if (resp.ok) {
        const more = await resp.json();
        const normalized = (Array.isArray(more) ? more : []).map(d => ({
          time: toSeconds(d.time),
          open: +d.open,
          high: +d.high,
          low: +d.low,
          close: +d.close
        })).filter(d => d.time !== null && d.time < earliest);
        if (normalized.length) {
          // prepend
          dataRef.current = normalized.concat(dataRef.current);
          // setData with new combined array
          if (seriesRef.current) seriesRef.current.setData(dataRef.current);
        } else {
          // no more history
        }
      } else {
        // backend may not support endTime; ignore
      }
    } catch (err) {
      console.error('Error loading older candles', err);
    } finally {
      isLoadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }

  // apply realtime updates (price prop)
  useEffect(() => {
    if (!seriesRef.current || !price) return;

    const tRaw = price.t ?? price.time ?? price.kline?.closeTime ?? price.kline?.openTime;
    const time = toSeconds(tRaw);
    if (time === null) return;

    const o = price.o ?? price.open ?? price.kline?.open;
    const h = price.h ?? price.high ?? price.kline?.high;
    const l = price.l ?? price.low ?? price.kline?.low;
    const c = price.c ?? price.close ?? price.kline?.close;

    const candle = {
      time,
      open: Number(o),
      high: Number(h),
      low: Number(l),
      close: Number(c)
    };

    const len = dataRef.current.length;
    const lastTime = lastTimeRef.current;

    if (lastTime == null) {
      // no history yet, add or update
      dataRef.current = [candle];
      lastTimeRef.current = candle.time;
      seriesRef.current.setData(dataRef.current);
      return;
    }

    if (candle.time === lastTime) {
      // update last candle in buffer and series
      dataRef.current[len - 1] = candle;
      seriesRef.current.update(candle);
    } else if (candle.time > lastTime) {
      // append
      dataRef.current.push(candle);
      lastTimeRef.current = candle.time;
      // lightweight-charts update can append via update()
      seriesRef.current.update(candle);
      try { chartRef.current.timeScale().scrollToRealTime(); } catch (e) {}
    } else {
      // older/out-of-order: ignore or optionally insert if wanted
    }
  }, [price]);

  // overlay UI (loading older)
  return (
    <div style={{ position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: 480 }} />
      {!ready && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', color: '#9ca3af', fontSize: 14
        }}>
          Loading chart...
        </div>
      )}
      {loadingOlder && (
        <div style={{
          position: 'absolute', left: 12, top: 12,
          background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '6px 10px', borderRadius: 6, fontSize: 12
        }}>
          Loading older history...
        </div>
      )}
      {tooltipState && (
        <div style={{
          position: 'absolute',
          pointerEvents: 'none',
          left: Math.max(8, tooltipState.left + 12),
          top: Math.max(8, tooltipState.top + 12),
          background: 'rgba(16,24,40,0.95)',
          color: '#fff',
          padding: '8px 10px',
          borderRadius: 6,
          fontSize: 12,
          whiteSpace: 'nowrap',
          boxShadow: '0 6px 18px rgba(2,6,23,0.6)'
        }}>
          {tooltipState.text}
        </div>
      )}
    </div>
  );
}
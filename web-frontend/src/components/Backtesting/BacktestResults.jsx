import React, { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';
import { TrendingUp, TrendingDown, DollarSign, Activity, Percent, Clock } from 'lucide-react';
import './Backtest.css';

export default function BacktestResults({ results }) {
    const chartContainerRef = useRef(null);

    // Formatters
    const formatUSD = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
    const formatPct = (val) => `${val.toFixed(2)}%`;

    // Draw Chart
    useEffect(() => {
        if (!results || !results.equity_curve || !chartContainerRef.current) return;

        // Get theme colors from CSS variables
        const styles = getComputedStyle(document.documentElement);
        const textColor = styles.getPropertyValue('--text-secondary').trim();
        const gridColor = styles.getPropertyValue('--border-color').trim();
        const accentBlue = '#3861fb'; // Fallback or parse var
        const topColor = 'rgba(56, 97, 251, 0.4)';
        const bottomColor = 'rgba(56, 97, 251, 0.0)';

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { color: 'transparent' },
                textColor: textColor || '#848e9c',
            },
            grid: {
                vertLines: { color: gridColor || '#252930', style: 3 },
                horzLines: { color: gridColor || '#252930', style: 3 }
            },
            width: chartContainerRef.current.clientWidth,
            height: 320,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: gridColor,
            },
            rightPriceScale: {
                borderColor: gridColor,
            },
        });

        const areaSeries = chart.addAreaSeries({
            lineColor: accentBlue,
            topColor: topColor,
            bottomColor: bottomColor,
            lineWidth: 2,
        });

        // Data mapping
        const data = results.equity_curve
            .filter(pt => pt.time && pt.value)
            .map(pt => ({
                time: new Date(pt.time).getTime() / 1000,
                value: pt.value
            }));

        data.sort((a, b) => a.time - b.time);

        if (data.length > 0) {
            areaSeries.setData(data);
            chart.timeScale().fitContent();
        }

        const handleResize = () => {
            chart.applyOptions({ width: chartContainerRef.current.clientWidth });
        };

        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, [results]);

    if (!results) return null;

    return (
        <div className="results-card">
            <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--border-color)', marginBottom: 16 }}>
                <h2 className="strategy-section-title" style={{ fontSize: 20, border: 'none', margin: 0 }}>
                    Performance Report
                    <span style={{ fontWeight: 'normal', color: 'var(--text-secondary)', marginLeft: 8, fontSize: 14 }}>
                        Strategy: {results.strategy_name || 'Untitled'}
                    </span>
                </h2>
            </div>

            {/* Metrics Grid */}
            <div className="metrics-grid">
                <StatCard
                    label="Net Profit"
                    value={formatUSD(results.net_profit)}
                    sub={formatPct(results.net_profit_percent)}
                    isPositive={results.net_profit >= 0}
                    icon={<DollarSign size={16} />}
                />
                <StatCard
                    label="Win Rate"
                    value={formatPct(results.win_rate)}
                    sub={`${results.winning_trades}W / ${results.losing_trades}L`}
                    isPositive={results.win_rate > 50}
                    icon={<Percent size={16} />}
                />
                <StatCard
                    label="Max Drawdown"
                    value={formatPct(results.max_drawdown)}
                    sub="Risk"
                    isPositive={false}
                    color="text-orange"
                    icon={<TrendingDown size={16} />}
                />
                <StatCard
                    label="Sharpe Ratio"
                    value={results.sharpe_ratio.toFixed(2)}
                    sub="Risk Adjusted"
                    isPositive={results.sharpe_ratio > 1}
                    icon={<Activity size={16} />}
                />
            </div>

            {/* Equity Curve Chart */}
            <div className="chart-wrapper" style={{ marginBottom: 24 }}>
                <div className="chart-title-bar">
                    <span className="chart-label">Equity Curve</span>
                    <span className={`badge ${results.net_profit >= 0 ? 'badge-long' : 'badge-short'}`}>
                        PnL: {formatUSD(results.net_profit)}
                    </span>
                </div>
                <div style={{ height: 320, position: 'relative' }}>
                    <div ref={chartContainerRef} style={{ width: '100%', height: '100%', position: 'absolute' }} />
                </div>
            </div>

            {/* Recent Trades Table */}
            <div>
                <h3 className="strategy-section-title">
                    <Clock size={16} /> Recent Trades
                    <span style={{ marginLeft: 8, color: 'var(--text-secondary)', fontSize: 12, fontWeight: 'normal' }}>
                        ({results.trades.length} total)
                    </span>
                </h3>

                <div className="table-container">
                    <table className="trade-table">
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Type</th>
                                <th style={{ textAlign: 'right' }}>Entry Price</th>
                                <th style={{ textAlign: 'right' }}>Exit Price</th>
                                <th style={{ textAlign: 'right' }}>Profit ($)</th>
                                <th style={{ textAlign: 'right' }}>Return %</th>
                            </tr>
                        </thead>
                        <tbody>
                            {results.trades.slice().reverse().slice(0, 50).map((trade, idx) => (
                                <tr key={idx}>
                                    <td style={{ color: 'var(--text-secondary)' }}>{new Date(trade.entry_time).toLocaleString()}</td>
                                    <td>
                                        <span className={`badge ${trade.side === 'long' ? 'badge-long' : 'badge-short'}`}>
                                            {trade.side.toUpperCase()}
                                        </span>
                                    </td>
                                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>${Number(trade.entry_price || 0).toFixed(2)}</td>
                                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }}>${trade.exit_price ? Number(trade.exit_price).toFixed(2) : '-'}</td>
                                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }} className={(trade.profit || 0) >= 0 ? 'text-green' : 'text-red'}>
                                        {(trade.profit || 0) >= 0 ? '+' : ''}{formatUSD(Number(trade.profit || 0))}
                                    </td>
                                    <td style={{ textAlign: 'right', fontFamily: 'monospace' }} className={(trade.return_percent || 0) >= 0 ? 'text-green' : 'text-red'}>
                                        {Number(trade.return_percent || 0).toFixed(2)}%
                                    </td>
                                </tr>
                            ))}
                            {results.trades.length === 0 && (
                                <tr>
                                    <td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>
                                        No trades executed.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

function StatCard({ label, value, sub, isPositive, color, icon }) {
    const valueColorClass = color ? color : (isPositive ? 'text-green' : 'text-red');

    return (
        <div className="stat-card">
            <div className="stat-label">
                {label}
                <span className={valueColorClass}>{icon}</span>
            </div>
            <div className={`stat-value ${valueColorClass}`}>{value}</div>
            <div className="stat-sub">
                {isPositive ? <TrendingUp size={12} className="text-green" /> : <TrendingDown size={12} className={color ? color : "text-red"} />}
                {sub}
            </div>
        </div>
    );
}

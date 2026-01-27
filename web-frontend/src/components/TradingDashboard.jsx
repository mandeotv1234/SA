import React, { useState } from 'react';
import MultiTimeframeChart from './MultiTimeframeChart';
import useStore from '../store';

const TIMEFRAMES = [
    { label: '1 Phút', value: '1m', api: '1m' },
    { label: '5 Phút', value: '5m', api: '5m' },
    { label: '1 Giờ', value: '1h', api: '1h' },
    { label: '1 Ngày', value: '1d', api: '1d' },
    { label: '1 Tuần', value: '1w', api: '1w' },
    { label: '1 Tháng', value: '1M', api: '1M' },
];

const SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'POLUSDT'
];

export default function TradingDashboard() {
    const { currentSymbol, setSymbol } = useStore();

    // State cho 4 biểu đồ - mỗi biểu đồ có timeframe riêng
    const [chart1TF, setChart1TF] = useState('1m');
    const [chart2TF, setChart2TF] = useState('1h');
    const [chart3TF, setChart3TF] = useState('1d');
    const [chart4TF, setChart4TF] = useState('1w');

    return (
        <div className="trading-dashboard">
            {/* Symbol Selector */}
            <div className="symbol-selector-bar">
                <h3>Chọn Coin:</h3>
                <div className="symbol-buttons">
                    {SYMBOLS.map(symbol => (
                        <button
                            key={symbol}
                            className={`symbol-btn ${currentSymbol === symbol ? 'active' : ''}`}
                            onClick={() => setSymbol(symbol)}
                        >
                            {symbol.replace('USDT', '')}
                        </button>
                    ))}
                </div>
            </div>

            {/* 4 Charts Grid */}
            <div className="charts-grid">
                {/* Chart 1 - Top Left */}
                <div className="chart-container">
                    <div className="chart-header">
                        <h4>{currentSymbol} - Biểu đồ 1</h4>
                        <select value={chart1TF} onChange={(e) => setChart1TF(e.target.value)}>
                            {TIMEFRAMES.map(tf => (
                                <option key={tf.value} value={tf.value}>{tf.label}</option>
                            ))}
                        </select>
                    </div>
                    <MultiTimeframeChart
                        symbol={currentSymbol}
                        timeframe={chart1TF}
                        chartId="chart1"
                    />
                </div>

                {/* Chart 2 - Top Right */}
                <div className="chart-container">
                    <div className="chart-header">
                        <h4>{currentSymbol} - Biểu đồ 2</h4>
                        <select value={chart2TF} onChange={(e) => setChart2TF(e.target.value)}>
                            {TIMEFRAMES.map(tf => (
                                <option key={tf.value} value={tf.value}>{tf.label}</option>
                            ))}
                        </select>
                    </div>
                    <MultiTimeframeChart
                        symbol={currentSymbol}
                        timeframe={chart2TF}
                        chartId="chart2"
                    />
                </div>

                {/* Chart 3 - Bottom Left */}
                <div className="chart-container">
                    <div className="chart-header">
                        <h4>{currentSymbol} - Biểu đồ 3</h4>
                        <select value={chart3TF} onChange={(e) => setChart3TF(e.target.value)}>
                            {TIMEFRAMES.map(tf => (
                                <option key={tf.value} value={tf.value}>{tf.label}</option>
                            ))}
                        </select>
                    </div>
                    <MultiTimeframeChart
                        symbol={currentSymbol}
                        timeframe={chart3TF}
                        chartId="chart3"
                    />
                </div>

                {/* Chart 4 - Bottom Right */}
                <div className="chart-container">
                    <div className="chart-header">
                        <h4>{currentSymbol} - Biểu đồ 4</h4>
                        <select value={chart4TF} onChange={(e) => setChart4TF(e.target.value)}>
                            {TIMEFRAMES.map(tf => (
                                <option key={tf.value} value={tf.value}>{tf.label}</option>
                            ))}
                        </select>
                    </div>
                    <MultiTimeframeChart
                        symbol={currentSymbol}
                        timeframe={chart4TF}
                        chartId="chart4"
                    />
                </div>
            </div>
        </div>
    );
}

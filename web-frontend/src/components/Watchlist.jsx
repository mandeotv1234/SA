import React, { useState } from 'react';
import useStore from '../store';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';

export default function Watchlist() {
    const { marketState, supportedSymbols, currentSymbol, setSymbol } = useStore();
    const [search, setSearch] = useState('');

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

            {/* List */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
                {filtered.map(symbol => {
                    const data = marketState[symbol] || {};
                    const price = data.price;
                    const change = data.change;
                    const isUp = change >= 0;
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
                            {price ? (
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: 13, fontFamily: 'monospace' }}>{price.toFixed(price < 10 ? 4 : 2)}</div>
                                    <div style={{ fontSize: 11, color: isUp ? 'var(--accent-green)' : 'var(--accent-red)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                                        {change.toFixed(2)}%
                                    </div>
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

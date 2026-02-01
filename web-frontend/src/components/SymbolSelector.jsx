import React, { useState } from 'react';
import useStore from '../store';
import { Search, ChevronDown } from 'lucide-react';

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'DOGEUSDT', 'ADAUSDT', 'XRPUSDT'];

export default function SymbolSelector() {
    const { currentSymbol, setSymbol } = useStore();
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');

    const filtered = SYMBOLS.filter(s => s.includes(search.toUpperCase()));

    return (
        <div className="symbol-selector">
            <button onClick={() => setIsOpen(!isOpen)} className="symbol-btn">
                <span style={{ fontWeight: 'bold' }}>{currentSymbol.replace('USDT', '')}</span>
                <span style={{ fontSize: '10px', color: '#777' }}>USDT</span>
                <ChevronDown size={14} />
            </button>

            {isOpen && (
                <div className="dropdown-menu">
                    <div className="dropdown-search">
                        <Search size={14} className="text-gray-400" />
                        <input
                            autoFocus
                            className="search-input"
                            placeholder="Tìm kiếm..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>
                    <div className="dropdown-list">
                        {filtered.map(s => (
                            <div
                                key={s}
                                onClick={() => { setSymbol(s); setIsOpen(false); }}
                                className={`dropdown-item ${s === currentSymbol ? 'active' : ''}`}
                            >
                                {s}
                            </div>
                        ))}
                        {filtered.length === 0 && <div style={{ padding: 12, fontSize: 12, color: '#777' }}>Không tìm thấy kết quả</div>}
                    </div>
                </div>
            )}
        </div>
    );
}

import React, { useEffect, useState } from 'react';
import useStore from '../store';
import { ExternalLink, Clock, RefreshCw } from 'lucide-react';
import { NewsListSkeleton } from './LoadingSpinner';

export default function NewsList() {
    const { authFetch, currentSymbol } = useStore();
    const [news, setNews] = useState([]);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const LIMIT = 10;

    useEffect(() => {
        setPage(1); // Reset page on symbol change
        loadNews(1);
    }, [currentSymbol]);

    useEffect(() => {
        loadNews(page);
    }, [page]); // Reload when page changes

    // Auto refresh current page every minute
    useEffect(() => {
        const interval = setInterval(() => loadNews(page), 60000);
        return () => clearInterval(interval);
    }, [page, currentSymbol]);

    const loadNews = async (pageNum) => {
        setLoading(true);
        try {
            const offset = (pageNum - 1) * LIMIT;
            const res = await authFetch(`/v1/news?limit=${LIMIT}&offset=${offset}`);
            if (res.ok) {
                const data = await res.json();
                setNews(data.rows || []);
                if (data.total) setTotal(data.total);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const totalPages = Math.ceil(total / LIMIT);

    const handlePrev = () => {
        if (page > 1) setPage(p => p - 1);
    };

    const handleNext = () => {
        if (page < totalPages) setPage(p => p + 1);
    };

    // Show skeleton when loading initially (page 1) or when explicitly loading new page data
    // Adjusted logic: show skeleton if loading AND we don't want to show stale data
    // But user asked to "keep loading as current" which implies smooth transition or skeleton
    // Let's use skeleton for better UX when switching pages
    if (loading && news.length === 0) {
        return (
            <div className="news-list" style={{ padding: '12px' }}>
                <NewsListSkeleton count={LIMIT} />
            </div>
        );
    }

    return (
        <div className="news-list" style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Loading overlay when refreshing in background */}
            {loading && news.length > 0 && (
                <div style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    zIndex: 10
                }}>
                    <RefreshCw size={14} className="spinning" style={{ color: 'var(--accent-blue)' }} />
                </div>
            )}

            <div style={{ flex: 1 }}>
                {loading ? (
                    <div style={{ padding: '12px' }}><NewsListSkeleton count={LIMIT} /></div>
                ) : news.length > 0 ? (
                    news.map((item, idx) => (
                        <div key={idx} className="news-item" style={{ animation: `fadeIn 0.3s ease-out ${idx * 0.05}s both` }}>
                            <div className="news-header">
                                <span className="source-tag">
                                    {item.source || (item.url ? new URL(item.url).hostname.replace('www.', '') : 'Unknown')}
                                </span>
                                <span className="time-tag">
                                    <Clock size={10} />
                                    {item.time ? new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                                </span>
                            </div>
                            <a href={item.url} target="_blank" rel="noreferrer" className="news-title">
                                {item.title}
                            </a>
                            {item.symbol && <span className="symbol-tag">{item.symbol}</span>}
                        </div>
                    ))
                ) : (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px' }}>
                        Không có tin tức nào ở trang này.
                    </div>
                )}
            </div>

            {/* Pagination Controls */}
            <div className="pagination-controls" style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 12px',
                borderTop: '1px solid var(--border-color)',
                marginTop: 'auto'
            }}>
                <button
                    onClick={handlePrev}
                    disabled={page === 1 || loading}
                    className="pagination-btn"
                    style={{
                        background: 'transparent',
                        border: '1px solid var(--border-color)',
                        color: page === 1 ? 'var(--text-tertiary)' : 'var(--text-primary)',
                        padding: '4px 10px',
                        borderRadius: '4px',
                        cursor: page === 1 || loading ? 'not-allowed' : 'pointer',
                        fontSize: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        opacity: page === 1 ? 0.5 : 1
                    }}
                >
                    &lt; Trước
                </button>

                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Trang {page} / {totalPages || '...'}
                </span>

                <button
                    onClick={handleNext}
                    disabled={loading || page >= totalPages || news.length === 0}
                    className="pagination-btn"
                    style={{
                        background: 'transparent',
                        border: '1px solid var(--border-color)',
                        color: (loading || page >= totalPages) ? 'var(--text-tertiary)' : 'var(--text-primary)',
                        padding: '4px 10px',
                        borderRadius: '4px',
                        cursor: (loading || page >= totalPages) ? 'not-allowed' : 'pointer',
                        fontSize: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        opacity: (loading || page >= totalPages) ? 0.5 : 1
                    }}
                >
                    Sau &gt;
                </button>
            </div>
        </div>
    );
}


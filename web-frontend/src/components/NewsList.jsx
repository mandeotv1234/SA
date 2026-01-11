import React, { useEffect, useState } from 'react';
import useStore from '../store';
import { ExternalLink, Clock } from 'lucide-react';

export default function NewsList() {
    const { authFetch } = useStore();
    const [news, setNews] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        loadNews();
        const interval = setInterval(loadNews, 60000);
        return () => clearInterval(interval);
    }, []);

    const loadNews = async () => {
        setLoading(true);
        try {
            const res = await authFetch('/v1/news?limit=20');
            if (res.ok) {
                const data = await res.json();
                setNews(data.rows || []);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    if (loading && news.length === 0) return <div className="loading-text">Loading news...</div>;

    return (
        <div className="news-list">
            {news.map((item, idx) => (
                <div key={idx} className="news-item">
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
            ))}
        </div>
    );
}

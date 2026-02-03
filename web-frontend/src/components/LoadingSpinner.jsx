import React from 'react';

/**
 * Loading Spinner Component with multiple variants
 */
export const LoadingSpinner = ({ size = 'md', color = 'primary', text = '' }) => {
    const sizeMap = {
        sm: { spinner: 20, border: 2 },
        md: { spinner: 40, border: 3 },
        lg: { spinner: 60, border: 4 },
        xl: { spinner: 80, border: 5 }
    };

    const colorMap = {
        primary: 'var(--accent-color, #3498db)',
        white: '#ffffff',
        gray: '#888888'
    };

    const { spinner, border } = sizeMap[size] || sizeMap.md;
    const spinnerColor = colorMap[color] || color;

    return (
        <div className="loading-spinner-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <div
                className="loading-spinner"
                style={{
                    width: spinner,
                    height: spinner,
                    border: `${border}px solid rgba(255,255,255,0.1)`,
                    borderTop: `${border}px solid ${spinnerColor}`,
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite'
                }}
            />
            {text && <span className="loading-text" style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{text}</span>}
        </div>
    );
};

/**
 * Skeleton Loading Component for placeholders
 */
export const Skeleton = ({ width = '100%', height = '20px', borderRadius = '4px', className = '' }) => {
    return (
        <div
            className={`skeleton ${className}`}
            style={{
                width,
                height,
                borderRadius,
                background: 'linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-tertiary, #333) 50%, var(--bg-secondary) 75%)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 1.5s infinite'
            }}
        />
    );
};

/**
 * Card Loading Skeleton
 */
export const CardSkeleton = ({ lines = 3, showAvatar = false }) => {
    return (
        <div className="card-skeleton" style={{ padding: '16px', display: 'flex', gap: '12px' }}>
            {showAvatar && <Skeleton width="40px" height="40px" borderRadius="50%" />}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {Array.from({ length: lines }).map((_, i) => (
                    <Skeleton key={i} width={i === 0 ? '60%' : i === lines - 1 ? '40%' : '90%'} height="14px" />
                ))}
            </div>
        </div>
    );
};

/**
 * Chart Loading Skeleton - shows animated chart placeholder
 */
export const ChartSkeleton = ({ height = '300px' }) => {
    return (
        <div
            className="chart-skeleton"
            style={{
                width: '100%',
                height,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                alignItems: 'flex-end',
                padding: '20px',
                background: 'var(--bg-secondary)',
                borderRadius: '8px',
                position: 'relative',
                overflow: 'hidden'
            }}
        >
            {/* Animated bars */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '70%', width: '100%' }}>
                {Array.from({ length: 12 }).map((_, i) => (
                    <div
                        key={i}
                        style={{
                            flex: 1,
                            height: `${30 + Math.random() * 60}%`,
                            background: 'linear-gradient(180deg, var(--accent-color) 0%, rgba(52, 152, 219, 0.3) 100%)',
                            borderRadius: '4px 4px 0 0',
                            animation: `pulse ${1 + Math.random()}s ease-in-out infinite`,
                            animationDelay: `${i * 0.1}s`,
                            opacity: 0.5
                        }}
                    />
                ))}
            </div>

            {/* Loading overlay */}
            <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)'
            }}>
                <LoadingSpinner size="md" text="Đang tải biểu đồ..." />
            </div>
        </div>
    );
};

/**
 * News List Loading Skeleton
 */
export const NewsListSkeleton = ({ count = 3 }) => {
    return (
        <div className="news-list-skeleton" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {Array.from({ length: count }).map((_, i) => (
                <div
                    key={i}
                    style={{
                        padding: '12px',
                        background: 'var(--bg-secondary)',
                        borderRadius: '8px',
                        animation: 'fadeIn 0.3s ease-out',
                        animationDelay: `${i * 0.1}s`
                    }}
                >
                    <Skeleton width="80%" height="16px" />
                    <div style={{ marginTop: '8px', display: 'flex', gap: '12px' }}>
                        <Skeleton width="60px" height="12px" />
                        <Skeleton width="80px" height="12px" />
                    </div>
                </div>
            ))}
        </div>
    );
};

/**
 * AI Insights Loading Skeleton
 */
export const InsightsSkeleton = () => {
    return (
        <div className="insights-skeleton" style={{ padding: '16px' }}>
            {/* Direction badge skeleton */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <Skeleton width="80px" height="32px" borderRadius="16px" />
                <Skeleton width="60px" height="24px" />
            </div>

            {/* Prediction text skeleton */}
            <Skeleton width="100%" height="14px" />
            <div style={{ marginTop: '8px' }}>
                <Skeleton width="90%" height="14px" />
            </div>
            <div style={{ marginTop: '8px' }}>
                <Skeleton width="70%" height="14px" />
            </div>

            {/* Stats skeleton */}
            <div style={{ display: 'flex', gap: '16px', marginTop: '16px' }}>
                <Skeleton width="100px" height="40px" borderRadius="8px" />
                <Skeleton width="100px" height="40px" borderRadius="8px" />
                <Skeleton width="100px" height="40px" borderRadius="8px" />
            </div>
        </div>
    );
};

/**
 * Investment Card Loading Skeleton
 */
export const InvestmentSkeleton = () => {
    return (
        <div className="investment-skeleton" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                <Skeleton width="120px" height="24px" />
                <Skeleton width="80px" height="24px" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} style={{ textAlign: 'center' }}>
                        <Skeleton width="100%" height="48px" borderRadius="8px" />
                        <div style={{ marginTop: '8px' }}>
                            <Skeleton width="60%" height="12px" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

/**
 * Full-page Loading Overlay
 */
export const LoadingOverlay = ({ show, text = 'Đang tải...' }) => {
    if (!show) return null;

    return (
        <div
            className="loading-overlay"
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.7)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 100,
                animation: 'fadeIn 0.2s ease-out'
            }}
        >
            <LoadingSpinner size="lg" text={text} />
        </div>
    );
};

export default LoadingSpinner;

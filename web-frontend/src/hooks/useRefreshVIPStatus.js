/**
 * Custom hook to refresh VIP status from server
 * Useful after payment completion or when mounting VIP-gated components
 */
import { useEffect } from 'react';
import useStore from '../store';

export function useRefreshVIPStatus() {
    const { authFetch, setIsVip, token } = useStore();

    useEffect(() => {
        if (!token) return;

        const refreshVIPStatus = async () => {
            try {
                const res = await authFetch('/auth/me');
                if (res.ok) {
                    const data = await res.json();
                    const isVip = !!data.user?.is_vip;

                    // Update store
                    setIsVip(isVip);

                    // Update localStorage
                    localStorage.setItem('isVip', String(isVip));

                    console.log('[VIP-REFRESH] Updated VIP status:', isVip);
                }
            } catch (error) {
                console.error('[VIP-REFRESH] Failed to refresh VIP status:', error);
            }
        };

        refreshVIPStatus();
    }, [token, authFetch, setIsVip]);
}

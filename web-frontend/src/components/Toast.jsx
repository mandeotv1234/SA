import React, { useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';

export default function Toast({ message, type = 'info', duration = 3000, onClose }) {
    useEffect(() => {
        const timer = setTimeout(() => {
            onClose();
        }, duration);

        return () => clearTimeout(timer);
    }, [duration, onClose]);

    const icons = {
        success: <CheckCircle size={20} />,
        error: <XCircle size={20} />,
        warning: <AlertCircle size={20} />,
        info: <Info size={20} />
    };

    const colors = {
        success: 'toast-success',
        error: 'toast-error',
        warning: 'toast-warning',
        info: 'toast-info'
    };

    return (
        <div className={`toast ${colors[type]}`}>
            <div className="toast-icon">
                {icons[type]}
            </div>
            <div className="toast-message">
                {message}
            </div>
            <button className="toast-close" onClick={onClose}>
                <X size={16} />
            </button>
        </div>
    );
}

import React from 'react';
import './ConfirmModal.css';
import { AlertTriangle, Info, CheckCircle, XCircle } from 'lucide-react';

const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message, type = 'warning' }) => {
    if (!isOpen) return null;

    const icons = {
        warning: <AlertTriangle size={48} className="modal-icon warning" />,
        info: <Info size={48} className="modal-icon info" />,
        success: <CheckCircle size={48} className="modal-icon success" />,
        danger: <XCircle size={48} className="modal-icon danger" />
    };

    return (
        <div className="confirm-modal-overlay" onClick={onClose}>
            <div className="confirm-modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="confirm-modal-header">
                    {icons[type]}
                    <h3>{title}</h3>
                </div>
                <div className="confirm-modal-body">
                    <p>{message}</p>
                </div>
                <div className="confirm-modal-footer">
                    <button className="btn-cancel" onClick={onClose}>
                        Hủy
                    </button>
                    <button
                        className={`btn-confirm btn-${type}`}
                        onClick={() => {
                            onConfirm();
                            onClose();
                        }}
                    >
                        Xác nhận
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmModal;

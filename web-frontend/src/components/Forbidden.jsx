import React from 'react';
import './Forbidden.css';
import { ShieldAlert } from 'lucide-react';
import { useTheme } from './ThemeProvider';

const Forbidden = () => {
    const { isDark } = useTheme();

    return (
        <div className={`forbidden-container ${isDark ? 'dark' : 'light'}`}>
            <div className="forbidden-content">
                <ShieldAlert size={80} className="forbidden-icon" />
                <h1>403 Forbidden</h1>
                <p>Bạn không có quyền truy cập vào trang này.</p>
                <p>Vui lòng liên hệ quản trị viên nếu bạn cho rằng đây là một sự nhầm lẫn.</p>
                <button onClick={() => window.location.href = '/'} className="btn-home">
                    Quay về Trang chủ
                </button>
            </div>
        </div>
    );
};

export default Forbidden;

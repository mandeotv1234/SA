import React from 'react';
import { MousePointer2, TrendingUp, Brush, Type, Grid, Smile, Ruler, Database } from 'lucide-react';

export default function LeftToolbar() {
    return (
        <div className="left-toolbar">
            <button className="toolbar-btn active" title="Crosshair">
                <MousePointer2 size={18} />
            </button>
            <button className="toolbar-btn" title="Trend Line">
                <TrendingUp size={18} />
            </button>
            <button className="toolbar-btn" title="Brush">
                <Brush size={18} />
            </button>
            <button className="toolbar-btn" title="Text">
                <Type size={18} />
            </button>
            <button className="toolbar-btn" title="Patterns">
                <Grid size={18} />
            </button>
            <button className="toolbar-btn" title="Prediction">
                <Database size={18} />
            </button>
            <button className="toolbar-btn" title="Icons">
                <Smile size={18} />
            </button>
            <button className="toolbar-btn" title="Measure">
                <Ruler size={18} />
            </button>
        </div>
    );
}

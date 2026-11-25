import React from 'react';

/**
 * Shared ShapeMarker SVG component.
 * Renders marker shapes as inline SVGs with a 16x16 viewBox.
 */
export const ShapeMarker: React.FC<{
    shape: string;
    color?: string;
    size?: number;
}> = ({ shape, color = '#000', size = 16 }) => {
    const getPath = () => {
        switch (shape) {
            case 'circle':
                return <circle cx="8" cy="8" r="6" fill={color} />;
            case 'square':
                return <rect x="2" y="2" width="12" height="12" fill={color} />;
            case 'diamond':
                return <path d="M 8 2 L 14 8 L 8 14 L 2 8 Z" fill={color} />;
            case 'cross':
                return <path d="M 8 2 L 8 14 M 2 8 L 14 8" stroke={color} strokeWidth="2" fill="none" />;
            case 'x':
                return <path d="M 2 2 L 14 14 M 14 2 L 2 14" stroke={color} strokeWidth="2" fill="none" />;
            case 'triangle-up':
                return <path d="M 8 2 L 14 14 L 2 14 Z" fill={color} />;
            case 'triangle-down':
                return <path d="M 8 14 L 14 2 L 2 2 Z" fill={color} />;
            case 'triangle-left':
                return <path d="M 2 8 L 14 2 L 14 14 Z" fill={color} />;
            case 'triangle-right':
                return <path d="M 14 8 L 2 2 L 2 14 Z" fill={color} />;
            case 'pentagon':
                return <path d="M 8 2 L 13.5 6 L 11 12 L 5 12 L 2.5 6 Z" fill={color} />;
            case 'hexagon':
                return <path d="M 8 1 L 13 4.5 L 13 11.5 L 8 15 L 3 11.5 L 3 4.5 Z" fill={color} />;
            case 'star':
                return <path d="M 8 1 L 9.5 6 L 15 6.5 L 11 10 L 12 15 L 8 12 L 4 15 L 5 10 L 1 6.5 L 6.5 6 Z" fill={color} />;
            case 'hourglass':
                return <path d="M 2 2 L 14 2 L 8 8 L 14 14 L 2 14 L 8 8 Z" fill={color} />;
            default:
                return <circle cx="8" cy="8" r="6" fill={color} />;
        }
    };

    return (
        <svg width={size} height={size} viewBox="0 0 16 16" style={{ flexShrink: 0 }}>
            {getPath()}
        </svg>
    );
};

export default ShapeMarker;

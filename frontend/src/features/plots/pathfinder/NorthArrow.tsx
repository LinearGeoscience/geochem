/**
 * NorthArrow Component
 *
 * SVG north arrow for publication-quality map figures.
 */

import React from 'react';

interface NorthArrowProps {
    size?: number;
    color?: string;
    style?: React.CSSProperties;
}

export const NorthArrow: React.FC<NorthArrowProps> = ({
    size = 24,
    color = '#333333',
    style
}) => {
    const height = size * 1.3;

    return (
        <svg
            width={size}
            height={height}
            viewBox="0 0 24 32"
            style={style}
        >
            {/* Arrow body */}
            <path
                d="M12 2 L18 24 L12 19 L6 24 Z"
                fill={color}
                stroke={color}
                strokeWidth="0.5"
            />
            {/* N label */}
            <text
                x="12"
                y="30"
                textAnchor="middle"
                fontSize="8"
                fontWeight="bold"
                fontFamily="Arial, sans-serif"
                fill={color}
            >
                N
            </text>
        </svg>
    );
};

export default NorthArrow;

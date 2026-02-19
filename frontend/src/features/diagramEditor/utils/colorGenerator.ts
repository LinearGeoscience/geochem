/**
 * Generate visually distinct colors for polygon boundaries
 */

// Golden ratio conjugate for hue distribution
const GOLDEN_RATIO_CONJUGATE = 0.618033988749895;

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;

    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }

    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255)
    };
}

/**
 * Generate N visually distinct colors using golden ratio spacing
 */
export function generateDistinctColors(count: number): { r: number; g: number; b: number }[] {
    const colors: { r: number; g: number; b: number }[] = [];
    let hue = 0;

    for (let i = 0; i < count; i++) {
        hue = (hue + GOLDEN_RATIO_CONJUGATE) % 1;
        // Alternate saturation and lightness for more variety
        const saturation = 0.65 + (i % 3) * 0.1;
        const lightness = 0.45 + (i % 2) * 0.1;
        colors.push(hslToRgb(hue * 360, saturation, lightness));
    }

    return colors;
}

/**
 * Generate a single distinct color given existing colors
 */
export function generateNextColor(existingCount: number): { r: number; g: number; b: number } {
    let hue = 0;
    for (let i = 0; i <= existingCount; i++) {
        hue = (hue + GOLDEN_RATIO_CONJUGATE) % 1;
    }
    const saturation = 0.65 + (existingCount % 3) * 0.1;
    const lightness = 0.45 + (existingCount % 2) * 0.1;
    return hslToRgb(hue * 360, saturation, lightness);
}

/**
 * Format RGB to CSS string
 */
export function rgbToCss(color: { r: number; g: number; b: number }, alpha?: number): string {
    if (alpha !== undefined) {
        return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
    }
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
}

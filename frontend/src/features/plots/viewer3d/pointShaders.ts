/**
 * GLSL for the point cloud. Visibility, clip box, section slab, isolation and
 * vertical exaggeration are all uniforms/attributes, so changing them never
 * rebuilds geometry — one draw call regardless of point count.
 *
 * Attributes: position (local, re-origined), color (rgba), size (px),
 * shape (SHAPE_INDEX: the same 13 marker shapes as the 2D plots),
 * flags (bit 0 = visible by attribute filter, bit 1 = selected).
 */

export const SHAPE_INDEX: Record<string, number> = {
    circle: 0, 'circle-open': 0,
    square: 1, 'square-open': 1,
    diamond: 2, 'diamond-open': 2,
    triangle: 3, 'triangle-up': 3, 'triangle-up-open': 3,
    cross: 4, 'cross-thin': 4,
    'triangle-down': 5, 'triangle-left': 6, 'triangle-right': 7,
    hexagon: 8, pentagon: 9, hourglass: 10, star: 11, x: 12, 'x-thin': 12,
};

export const POINT_VERTEX_SHADER = /* glsl */ `
attribute vec4 color;
attribute float size;
attribute float shape;
attribute float flags;

uniform float uSizeScale;
uniform float uPixelRatio;
uniform float uVex;
uniform float uBoxEnabled;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform float uSlabEnabled;
uniform vec3 uSlabNormal;
uniform vec3 uSlabCenter;
uniform float uSlabHalf;
uniform float uIsolate;
uniform float uHasSelection;

varying vec4 vColor;
varying float vShape;
varying float vSelected;

void main() {
    float visible = mod(flags, 2.0);
    float selected = floor(flags / 2.0 + 0.001);
    vec3 p = position;

    bool hidden = visible < 0.5;
    if (uBoxEnabled > 0.5 && (any(lessThan(p, uBoxMin)) || any(greaterThan(p, uBoxMax)))) hidden = true;
    if (uSlabEnabled > 0.5 && abs(dot(p - uSlabCenter, uSlabNormal)) > uSlabHalf) hidden = true;
    if (uIsolate > 0.5 && uHasSelection > 0.5 && selected < 0.5) hidden = true;

    if (hidden) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside clip space
        gl_PointSize = 0.0;
        return;
    }

    vec4 mv = modelViewMatrix * vec4(p.x, p.y, p.z * uVex, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(1.0, size * uSizeScale * uPixelRatio * (selected > 0.5 ? 1.35 : 1.0));
    vColor = color;
    vShape = shape;
    vSelected = selected;
}
`;

export const POINT_FRAGMENT_SHADER = /* glsl */ `
uniform float uHasSelection;
uniform vec3 uSelectionColor;

varying vec4 vColor;
varying float vShape;
varying float vSelected;

// Upward triangle in the unit square; edge = 0 at centre .. 1 at the outline
bool tri(vec2 c, out float edge) {
    float halfW = 0.95 * (1.0 - c.y) / 1.75;
    edge = max(abs(c.x) / max(halfW, 0.001), (-c.y) / 0.75);
    return c.y >= -0.75 && c.y <= 1.0 && abs(c.x) <= halfW;
}

// Regular n-gon (vertex up), apothem 0.8
bool ngon(vec2 c, float n, out float edge) {
    float a = atan(c.x, c.y);
    float b = 6.2831853 / n;
    float d = cos(floor(0.5 + a / b) * b - a) * length(c);
    edge = d / 0.8;
    return d <= 0.8;
}

bool crossShape(vec2 c, out float edge) {
    edge = max(abs(c.x), abs(c.y));
    return min(abs(c.x), abs(c.y)) <= 0.28 && edge <= 1.0;
}

void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    c.y = -c.y;
    float s = vShape;
    bool inside;
    float edge; // 0 at centre .. 1 at the outline
    if (s < 0.5) {
        float r2 = dot(c, c);
        inside = r2 <= 1.0;
        edge = sqrt(r2);
    } else if (s < 1.5) {
        float m = max(abs(c.x), abs(c.y));
        inside = m <= 0.85;
        edge = m / 0.85;
    } else if (s < 2.5) {
        float m = abs(c.x) + abs(c.y);
        inside = m <= 1.0;
        edge = m;
    } else if (s < 3.5) {
        inside = tri(c, edge);
    } else if (s < 4.5) {
        inside = crossShape(c, edge);
    } else if (s < 5.5) {
        inside = tri(vec2(c.x, -c.y), edge);          // triangle-down
    } else if (s < 6.5) {
        inside = tri(vec2(c.y, -c.x), edge);          // triangle-left
    } else if (s < 7.5) {
        inside = tri(vec2(-c.y, c.x), edge);          // triangle-right
    } else if (s < 8.5) {
        inside = ngon(vec2(c.y, c.x), 6.0, edge);     // hexagon (flat top)
    } else if (s < 9.5) {
        inside = ngon(c, 5.0, edge);                  // pentagon
    } else if (s < 10.5) {
        edge = max(abs(c.y) / 0.9, abs(c.x) / max(abs(c.y), 0.001));
        inside = abs(c.y) <= 0.9 && abs(c.x) <= abs(c.y);   // hourglass
    } else if (s < 11.5) {
        float a = atan(c.x, c.y);
        float r = 0.95 * (0.5 + 0.5 * pow(abs(cos(2.5 * a)), 3.0));
        edge = length(c) / max(r, 0.001);
        inside = length(c) <= r;                       // star
    } else {
        inside = crossShape(vec2(c.x + c.y, c.x - c.y) * 0.7071, edge);   // x
    }
    if (!inside) discard;

    vec4 col = vColor;
    if (uHasSelection > 0.5) {
        if (vSelected > 0.5) {
            if (edge > 0.7) col = vec4(uSelectionColor, 1.0); // highlight ring
        } else {
            col.a *= 0.25; // de-emphasise the rest
        }
    }
    if (col.a < 0.02) discard;
    gl_FragColor = col;
}
`;

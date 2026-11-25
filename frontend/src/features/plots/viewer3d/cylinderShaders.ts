/**
 * GLSL for drillhole intervals drawn as cylinders: one closed cylinder
 * (intervals.ts cylinderTemplate) instanced once per dataset row and placed
 * between that row's From and To ends in the vertex shader. As with the
 * points, visibility, clip box, slices, isolation, vertical
 * exaggeration and width are uniforms/attributes: changing them never
 * rebuilds geometry.
 *
 * Template attributes: position (cos, sin, t), normal.
 * Per-row (instanced) attributes: iStart / iEnd (interval ends, local), iMid
 * (the row's point position: the clip tests match the points and selection),
 * color (rgba), size (px, the Size attribute), flags (bit 0 visible, bit 1 selected),
 * emph (high-grade emphasis: rank for highs in front, fade towards the background).
 */
import { XRAY_GLSL } from './pointShaders';

/** Point size (px) that draws a cylinder at exactly the chosen width. */
export const CYLINDER_BASE_SIZE = 8;

export const CYLINDER_VERTEX_SHADER = /* glsl */ `
attribute vec3 iStart;
attribute vec3 iEnd;
attribute vec3 iMid;
attribute vec4 color;
attribute float size;
attribute float flags;

uniform float uVex;
uniform float uBoxEnabled;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform float uSlabEnabled;
uniform vec3 uSlabNormal;
uniform vec3 uSlabCenter;
uniform vec2 uSlabRange;
uniform float uSlab2Enabled;
uniform vec3 uSlab2Normal;
uniform vec3 uSlab2Center;
uniform vec2 uSlab2Range;
uniform float uIsolate;
uniform float uHasSelection;
uniform float uRadius;
uniform float uSizeByAttr;
uniform float uBaseSize;
uniform float uMinPixels;
uniform float uViewHeight;
/** Over 0: drawn beside the hole, not round it, this far (m; the samples' radius) plus its own radius from the hole's middle */
uniform float uSide;

varying vec3 vColor;
varying vec3 vNormal;
varying float vSelected;
varying float vFade;
${XRAY_GLSL}
void main() {
    float visible = mod(flags, 2.0);
    float selected = floor(flags / 2.0 + 0.001);

    // Same tests as the points, on the sample's own position
    bool hidden = visible < 0.5 || color.a < 0.02;
    if (uBoxEnabled > 0.5 && (any(lessThan(iMid, uBoxMin)) || any(greaterThan(iMid, uBoxMax)))) hidden = true;
    if (uSlabEnabled > 0.5) {
        float d = dot(iMid - uSlabCenter, uSlabNormal);
        if (d < uSlabRange.x || d > uSlabRange.y) hidden = true;
    }
    if (uSlab2Enabled > 0.5) {
        float d = dot(iMid - uSlab2Center, uSlab2Normal);
        if (d < uSlab2Range.x || d > uSlab2Range.y) hidden = true;
    }
    if (uIsolate > 0.5 && uHasSelection > 0.5 && selected < 0.5) hidden = true;

    // Exaggerate the ends, then build the cylinder: its cross-section stays round
    vec3 s = vec3(iStart.xy, iStart.z * uVex);
    vec3 e = vec3(iEnd.xy, iEnd.z * uVex);
    vec3 axis = e - s;
    float len = length(axis);
    if (len < 1e-6) hidden = true; // rows without an interval

    if (hidden) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside clip space
        return;
    }

    vec3 a = axis / len;
    vec3 helper = abs(a.z) < 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 u = normalize(cross(helper, a));
    vec3 v = cross(a, u);

    vec3 centre = s + axis * position.z;
    vec4 mvCentre = modelViewMatrix * vec4(centre, 1.0);

    float r = uRadius * (uSizeByAttr > 0.5 ? size / uBaseSize : 1.0);
    // Never thinner than uMinPixels on screen, so holes do not vanish when zoomed out
    bool perspective = projectionMatrix[2][3] == -1.0;
    float pxPerMetre = projectionMatrix[1][1] * uViewHeight * 0.5 / (perspective ? max(-mvCentre.z, 1e-6) : 1.0);
    r = max(r, uMinPixels / pxPerMetre);

    vec3 p = centre + r * (position.x * u + position.y * v);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    if (uSide > 0.0) {
        // Beside the hole on the screen (to the right of it, going down it), clear of the samples drawn round it
        vec3 av = (modelViewMatrix * vec4(a, 0.0)).xyz;
        vec2 side = length(av.xy) > 1e-6 ? normalize(vec2(-av.y, av.x)) : vec2(1.0, 0.0);
        mv.xy += side * (max(uSide, 1.0 / pxPerMetre) + r);
    }
    gl_Position = projectionMatrix * mv;
    xrayDepth();

    vNormal = normalMatrix * (normal.x * u + normal.y * v + normal.z * a);
    vColor = color.rgb;
    vSelected = selected;
    vFade = emph.y;
}
`;

export const CYLINDER_FRAGMENT_SHADER = /* glsl */ `
uniform float uHasSelection;
uniform vec3 uSelectionColor;
uniform vec3 uBackground;

varying vec3 vColor;
varying vec3 vNormal;
varying float vSelected;
varying float vFade;

void main() {
    // Lit from the camera: full colour facing the viewer, darker towards the edges
    float facing = abs(normalize(vNormal).z);
    // High-grade emphasis: the lower values recede into the background (stays opaque)
    vec3 col = mix(uBackground, vColor, clamp(vFade, 0.0, 1.0));
    if (uHasSelection > 0.5) {
        if (vSelected > 0.5) {
            col = mix(uSelectionColor, col, smoothstep(0.45, 0.7, facing)); // highlight rim
        } else {
            col = mix(uBackground, col, 0.3); // de-emphasise the rest (stays opaque)
        }
    }
    gl_FragColor = vec4(col * (0.5 + 0.5 * facing), 1.0);
}
`;

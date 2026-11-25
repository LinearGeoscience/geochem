/**
 * Imperative three.js viewport for the 3D viewer.
 *
 * Plain three.js (no react-three-fiber): R3F augments the global JSX
 * namespace with every three.js element, which pushed MUI's polymorphic
 * component types past TypeScript's union-size limit (TS2590) in unrelated
 * files. The React component (Viewer3D) owns one ThreeViewport and pushes
 * data/settings into it; rendering is on demand (no continuous loop).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { POINT_VERTEX_SHADER, POINT_FRAGMENT_SHADER } from './pointShaders';
import { CYLINDER_VERTEX_SHADER, CYLINDER_FRAGMENT_SHADER, CYLINDER_BASE_SIZE } from './cylinderShaders';
import { IntervalGeometry, cylinderTemplate, rowsWithoutInterval, pickInterval } from './intervals';
import { PointCloudGeometry, ClipState, ClipSlab, SLAB_OPEN, niceTicks, projectToScreen, findViewFocus, isInsideClip, loosenClip, parseCssColor } from './geometry';
import type { ViewerStyleBuffers, DrillholeSegments } from './useViewerData';
import type { GroundTile } from './satelliteTiles';
import type { WireframePart } from './wireframeParsers';
import { cutMesh, fillCut } from './meshCut';

export type ViewPreset = 'plan' | 'north' | 'south' | 'east' | 'west' | 'iso';

/** Outline of one slice's mid-plane: xyz corners in local coordinates, in order around the loop. */
export interface SliceFrame { corners: number[]; color: string }

/** Lines and labels on a section's plane (local coordinates, true elevation) */
export interface PlaneGrid { lines: number[]; labels: { text: string; p: [number, number, number] }[]; color: string }

/** A hole to point out: its path (xyz list, local coordinates, from the top), name and colour. */
export interface HoleMarker {
    path: number[];
    label: string;
    color: string;
    /** Lighter: a hole only pointed at in the list */
    faint?: boolean;
    /** Draw the thick line along the hole as well as the name tag at its top (it covers the samples) */
    line?: boolean;
    /** Gives the tag a × that calls this */
    onDismiss?: () => void;
}

export interface CameraState {
    position: [number, number, number];
    target: [number, number, number];
    zoom: number;
    ortho: boolean;
}

/** World-space clipping planes (vertical exaggeration applied) matching the shader tests. */
export function clipPlanes(clip: ClipState, vex: number): THREE.Plane[] {
    const planes: THREE.Plane[] = [];
    if (clip.boxEnabled) {
        const [x0, y0, z0] = clip.boxMin;
        const [x1, y1, z1] = clip.boxMax;
        planes.push(
            new THREE.Plane(new THREE.Vector3(1, 0, 0), -x0),
            new THREE.Plane(new THREE.Vector3(-1, 0, 0), x1),
            new THREE.Plane(new THREE.Vector3(0, 1, 0), -y0),
            new THREE.Plane(new THREE.Vector3(0, -1, 0), y1),
            new THREE.Plane(new THREE.Vector3(0, 0, 1), -z0 * vex),
            new THREE.Plane(new THREE.Vector3(0, 0, -1), z1 * vex),
        );
    }
    for (const slab of clip.slabs) {
        // Local plane n·(p - c) = ±h with p.z = z'/vex  ->  world normal (nx, ny, nz/vex)
        const [nx, ny, nz] = slab.normal;
        const w = new THREE.Vector3(nx, ny, nz / vex);
        const len = w.length();
        const nc = nx * slab.center[0] + ny * slab.center[1] + nz * slab.center[2];
        const n = w.clone().divideScalar(len);
        // Keep lo <= n·p - nc <= hi; a side with no limit needs no plane
        if (slab.lo > -SLAB_OPEN / 2) planes.push(new THREE.Plane(n.clone(), (-nc - slab.lo) / len));
        if (slab.hi < SLAB_OPEN / 2) planes.push(new THREE.Plane(n.clone().negate(), (nc + slab.hi) / len));
    }
    return planes;
}

function formatTick(v: number): string {
    const a = Math.abs(v);
    if (a >= 1e5) return Math.round(v).toLocaleString();
    if (a >= 100) return v.toFixed(0);
    return String(Number(v.toPrecision(4)));
}

// ---------------------------------------------------------------------------
// Wireframes (meshes / lines loaded from Leapfrog .msh, DXF, OBJ, STL, GOCAD)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Handles: the control points of the surface being edited
// ---------------------------------------------------------------------------

/**
 * Marks of a fixed size on screen, ringed so they read on any background:
 * round dots (a surface's points), squares (`uSquare`: the nodes of its lines)
 * or a ring only (`uHollow`). Each is at its place in space: the slices cut
 * them away like the data (the material's clipping planes).
 */
const HANDLE_VERTEX_SHADER = `
    #include <clipping_planes_pars_vertex>
    attribute float aSize;
    uniform float uPixelRatio;
    void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = aSize * uPixelRatio;
        #include <clipping_planes_vertex>
    }
`;
const HANDLE_FRAGMENT_SHADER = `
    #include <clipping_planes_pars_fragment>
    uniform vec3 uColor;
    uniform float uHollow;
    uniform float uSquare;
    void main() {
        #include <clipping_planes_fragment>
        vec2 c = gl_PointCoord - 0.5;
        float r = uSquare > 0.5 ? max(abs(c.x), abs(c.y)) * 2.0 : length(c) * 2.0;
        if (r > 1.0) discard;
        if (uHollow > 0.5 && r < 0.5) discard;
        vec3 col = r > 0.86 ? vec3(0.1) : r > 0.64 ? vec3(1.0) : uColor;
        if (uHollow > 0.5) col = r > 0.86 || r < 0.6 ? vec3(0.1) : uColor;
        gl_FragColor = vec4(col, 1.0);
    }
`;

export interface HandleSet {
    /** Local xyz, 3 per handle (vertical exaggeration not applied) */
    positions: Float32Array;
    color: string;
    /** The handle under the cursor or being dragged: drawn larger (-1: none) */
    active: number;
    /** Smaller dots: shown for reference, not being edited */
    quiet?: boolean;
}

/** The places and links put on a surface by hand, as `setControls` draws them (local xyz, vertical exaggeration not applied) */
export interface ControlSet {
    /** A dot at each place, and at each end of each link: 3 numbers a dot */
    dots: Float32Array;
    dotSide: Int8Array;
    /** Each link from one end to the other: 6 numbers a link */
    links: Float32Array;
    linkSide: Int8Array;
    dotPicked: Uint8Array;
    linkPicked: Uint8Array;
    /** The dot or the link under the cursor (-1: none) */
    hotDot: number;
    hotLink: number;
    /** Smaller: shown for reference, the surface is not being edited */
    quiet: boolean;
    colors: Record<1 | -1, string>;
}

/** Things drawn exactly on the edge of a slice are kept: the slices are taken this much thicker (m) for the marks */
const EDGE_SLACK = 0.05;

/** A mesh to draw: a loaded wireframe, or a surface built in the project's scene. */
export interface MeshLayer {
    id: string;
    part: WireframePart;
    color: string;
    /** Surface opacity; 0 hides the surface (edges and lines still draw) */
    opacity: number;
    visible: boolean;
    /** Draw the triangle edges */
    showEdges: boolean;
    /** Picked (in the project tree): lit, its outline and lines in the pick colour */
    selected?: boolean;
    /** A colour for each vertex in place of `color` (red, green, blue, 0 to 1, linear): a mesh coloured by a number at each place of it */
    vertexColors?: Float32Array | null;
    /** Draw its outline: its rim and its creases, as lines (with its faces and triangle edges or without) */
    creases?: boolean;
    /** The slices do not cut it (the clip box still does) */
    whole?: boolean;
    /**
     * While a slice is on, in place of what of it lies in the slice: the line where the slice's own plane cuts it
     * (no width, however wide the slice), or its section on that plane filled (a mesh not closed there: its line)
     */
    onSlice?: 'line' | 'filled';
}

/** The colour of what is picked */
export const PICKED_COLOR = '#ffb300';

interface WireObject {
    part: WireframePart;
    /** Origin the float32 positions were built for */
    originKey: string;
    group: THREE.Group;
    mesh: THREE.Mesh | null;
    lines: THREE.LineSegments | null;
    edges: THREE.LineSegments | null;
    /** The open edges, drawn while it is picked (undefined: not worked out yet; null: none to draw) */
    outline: THREE.LineSegments | null | undefined;
    /** Its rim and creases, drawn when it is drawn as an outline (undefined: not worked out yet; null: none to draw) */
    creases: THREE.LineSegments | null | undefined;
    /** The slices leave it whole */
    whole: boolean;
    /** On a slice it is its line there, or its section filled (null: cut as everything is, or whole) */
    onSlice: 'line' | 'filled' | null;
    /** What of it is drawn when no slice takes its place (as styled) */
    show: { mesh: boolean; edges: boolean; creases: boolean; outline: boolean; lines: boolean };
    /** Its colour, and that of its section's fill and how see-through that is */
    look: { color: string; picked: boolean; fill: number };
    /** Its cut by each slice that is on (in the slices' order) */
    cuts: WireCut[];
    meshMaterial: THREE.MeshPhongMaterial;
    lineMaterial: THREE.LineBasicMaterial;
    edgeMaterial: THREE.LineBasicMaterial;
    outlineMaterial: THREE.LineBasicMaterial;
    creaseMaterial: THREE.LineBasicMaterial;
    /** The colours its vertices are drawn in now (null: its one colour) */
    shade: Float32Array | null;
}

/** How wide the line of a cut is drawn, in pixels */
const CUT_LINE_PX = 1.75;

/** A mesh's cut by one slice's plane, as drawn */
interface WireCut {
    /** The plane and the kind it was made for */
    key: string;
    group: THREE.Group;
    line: LineSegments2 | null;
    fill: THREE.Mesh | null;
    lineMaterial: LineMaterial;
    fillMaterial: THREE.MeshBasicMaterial;
    /** The area of its section there (null: not closed, or not filled) */
    area: number | null;
}

function disposeCut(w: WireObject, c: WireCut) {
    w.group.remove(c.group);
    c.line?.geometry.dispose();
    c.fill?.geometry.dispose();
    c.lineMaterial.dispose();
    c.fillMaterial.dispose();
}

/** A mesh's cut by a slice's own plane (`n . p = d` in the mesh's local coordinates): its line, and its inside filled when asked for */
function buildCut(w: WireObject, key: string, n: [number, number, number], d: number, filled: boolean): WireCut {
    const group = new THREE.Group();
    // (Its width is on the screen, the same near and far: on the ground the line has none)
    const lineMaterial = new LineMaterial({ linewidth: CUT_LINE_PX });
    // Flat, as a section is drawn; pushed back a little so its own line stays in front of it
    const fillMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const c: WireCut = { key, group, line: null, fill: null, lineMaterial, fillMaterial, area: null };
    const position = w.mesh?.geometry.getAttribute('position');
    const cut = position ? cutMesh(position.array, w.part.triangles, n, d) : null;
    if (cut) {
        const at = new THREE.BufferAttribute(cut.points, 3);
        const ends = new Float32Array(cut.segments.length * 3);
        for (let i = 0; i < cut.segments.length; i++) ends.set(cut.points.subarray(cut.segments[i] * 3, cut.segments[i] * 3 + 3), i * 3);
        const g = new LineSegmentsGeometry();
        g.setPositions(ends);
        c.line = new LineSegments2(g, lineMaterial);
        c.line.frustumCulled = false;
        c.line.renderOrder = 2;
        group.add(c.line);
        const fill = filled ? fillCut(cut, n) : null;
        if (fill) {
            const f = new THREE.BufferGeometry();
            f.setAttribute('position', at);
            f.setIndex(new THREE.BufferAttribute(fill.triangles, 1));
            c.fill = new THREE.Mesh(f, fillMaterial);
            c.fill.frustumCulled = false;
            c.fill.renderOrder = 1;
            group.add(c.fill);
            c.area = fill.area;
        }
    }
    w.group.add(group);
    return c;
}

function buildWire(part: WireframePart, origin: [number, number, number], originKey: string): WireObject {
    // Subtract the origin in float64, then store float32 (same as the points)
    const n = part.vertices.length / 3;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i += 3) {
        pos[i] = part.vertices[i] - origin[0];
        pos[i + 1] = part.vertices[i + 1] - origin[1];
        pos[i + 2] = part.vertices[i + 2] - origin[2];
    }
    const position = new THREE.BufferAttribute(pos, 3);
    const group = new THREE.Group();
    const meshMaterial = new THREE.MeshPhongMaterial({
        side: THREE.DoubleSide, specular: 0x111111, shininess: 20,
        // Push the surface back a little so its own edges and coincident lines stay visible
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    const lineMaterial = new THREE.LineBasicMaterial();
    const edgeMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.7 });
    // Seen through what is in front, as a pick is
    const outlineMaterial = new THREE.LineBasicMaterial({ color: PICKED_COLOR, transparent: true, opacity: 0.95, depthTest: false });
    const creaseMaterial = new THREE.LineBasicMaterial();

    let mesh: THREE.Mesh | null = null;
    if (part.triangles.length > 0) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', position);
        g.setIndex(new THREE.BufferAttribute(part.triangles, 1));
        g.computeVertexNormals();
        mesh = new THREE.Mesh(g, meshMaterial);
        mesh.frustumCulled = false;
        mesh.renderOrder = 1; // after the points, so they show through translucent shells
        group.add(mesh);
    }
    let lines: THREE.LineSegments | null = null;
    if (part.lines.length > 0) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', position);
        g.setIndex(new THREE.BufferAttribute(part.lines, 1));
        lines = new THREE.LineSegments(g, lineMaterial);
        lines.frustumCulled = false;
        group.add(lines);
    }
    return {
        part, originKey, group, mesh, lines, edges: null, outline: undefined, creases: undefined, whole: false,
        onSlice: null, show: { mesh: !!mesh, edges: false, creases: false, outline: false, lines: true }, look: { color: '#888888', picked: false, fill: 1 }, cuts: [],
        meshMaterial, lineMaterial, edgeMaterial, outlineMaterial, creaseMaterial, shade: null,
    };
}

/** Two faces that meet at more than this angle (degrees) meet in a crease */
export const CREASE_DEGREES = 30;

/**
 * The outline of a mesh as index pairs: its rim (edges of one triangle), its
 * creases (edges where two triangles meet at more than `degrees`) and edges
 * of three triangles or more. Triangles of no area say nothing of a crease.
 */
export function creaseIndex(tris: ArrayLike<number>, vertices: ArrayLike<number>, nVerts: number, degrees = CREASE_DEGREES): Uint32Array {
    const nT = Math.floor(tris.length / 3);
    const normal = new Float32Array(nT * 3);
    for (let t = 0; t < nT; t++) {
        const a = tris[3 * t] * 3, b = tris[3 * t + 1] * 3, c = tris[3 * t + 2] * 3;
        const ux = vertices[b] - vertices[a], uy = vertices[b + 1] - vertices[a + 1], uz = vertices[b + 2] - vertices[a + 2];
        const vx = vertices[c] - vertices[a], vy = vertices[c + 1] - vertices[a + 1], vz = vertices[c + 2] - vertices[a + 2];
        const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
        const len = Math.hypot(x, y, z);
        if (len > 0) { normal[3 * t] = x / len; normal[3 * t + 1] = y / len; normal[3 * t + 2] = z / len; }
    }
    const flat = (t: number) => normal[3 * t] === 0 && normal[3 * t + 1] === 0 && normal[3 * t + 2] === 0;
    const least = Math.cos((degrees * Math.PI) / 180);
    // By edge: the one triangle met so far (0 and up), DONE once given out, SMOOTH for two that meet without a crease
    const DONE = -1, SMOOTH = -2;
    const met = new Map<number, number>();
    const out: number[] = [];
    for (let t = 0; t < nT; t++) {
        for (let k = 0; k < 3; k++) {
            const a = tris[3 * t + k], b = tris[3 * t + ((k + 1) % 3)];
            const key = a < b ? a * nVerts + b : b * nVerts + a;
            const was = met.get(key);
            if (was === undefined) { met.set(key, t); continue; }
            if (was === DONE) continue;
            // A third triangle on an edge, or two that turn: a line
            // (Two faces wound either way round lie in one plane all the same: the angle between the planes, not the windings)
            const turn = was === SMOOTH || (!flat(was) && !flat(t)
                && Math.abs(normal[3 * was] * normal[3 * t] + normal[3 * was + 1] * normal[3 * t + 1] + normal[3 * was + 2] * normal[3 * t + 2]) < least);
            if (turn) { out.push(a, b); met.set(key, DONE); } else met.set(key, SMOOTH);
        }
    }
    for (const [key, was] of met) if (was >= 0) out.push(Math.floor(key / nVerts), key % nVerts);
    return Uint32Array.from(out);
}

/**
 * The edges of only one triangle (a surface's rim) as index pairs; null when
 * there are none (a closed shell) or when every edge is (triangles that do
 * not share their corners: the rim would be the whole mesh).
 */
export function openEdgeIndex(tris: ArrayLike<number>, nVerts: number): Uint32Array | null {
    const count = new Map<number, number>();
    for (let t = 0; t + 2 < tris.length; t += 3) {
        for (let k = 0; k < 3; k++) {
            const a = tris[t + k], b = tris[t + ((k + 1) % 3)];
            const key = a < b ? a * nVerts + b : b * nVerts + a;
            count.set(key, (count.get(key) ?? 0) + 1);
        }
    }
    const out: number[] = [];
    for (const [key, n] of count) if (n === 1) out.push(Math.floor(key / nVerts), key % nVerts);
    if (out.length === 0 || out.length / 2 === count.size) return null;
    return Uint32Array.from(out);
}

/** Unique triangle edges as index pairs (shares the mesh's vertex buffer). */
function edgeIndex(tris: Uint32Array, nVerts: number): Uint32Array {
    const seen = new Set<number>();
    const out: number[] = [];
    for (let t = 0; t < tris.length; t += 3) {
        for (let k = 0; k < 3; k++) {
            const a = tris[t + k], b = tris[t + ((k + 1) % 3)];
            const key = a < b ? a * nVerts + b : b * nVerts + a;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(a, b);
        }
    }
    return Uint32Array.from(out);
}

function styleWire(w: WireObject, layer: MeshLayer) {
    w.group.visible = layer.visible;
    const color = new THREE.Color(layer.color);
    const m = w.meshMaterial;
    const translucent = layer.opacity < 0.999;
    if (m.transparent !== translucent) {
        m.transparent = translucent;
        m.needsUpdate = true;
    }
    // Coloured place by place: the vertices carry the colour, and the material lets it through as it is
    const shade = w.mesh && layer.vertexColors && layer.vertexColors.length === w.part.vertices.length ? layer.vertexColors : null;
    if (w.shade !== shade && w.mesh) {
        if (shade) w.mesh.geometry.setAttribute('color', new THREE.BufferAttribute(shade, 3)); else w.mesh.geometry.deleteAttribute('color');
        m.vertexColors = !!shade;
        m.needsUpdate = true;
        w.shade = shade;
    }
    if (shade) m.color.set(0xffffff); else m.color.copy(color);
    m.opacity = layer.opacity;
    m.depthWrite = !translucent;
    if (w.mesh) w.mesh.visible = layer.opacity > 0.001;
    // Picked: lit towards the pick colour, its lines in it, its rim drawn
    const picked = !!layer.selected;
    // (Not one coloured place by place: the glow would change what its colours say; its rim still shows it is picked)
    const lit = picked && !shade;
    m.emissive.set(lit ? PICKED_COLOR : 0x000000).multiplyScalar(lit ? 0.3 : 0);
    if (picked && w.outline === undefined) {
        const rim = w.mesh ? openEdgeIndex(w.part.triangles, w.part.vertices.length / 3) : null;
        w.outline = null;
        if (rim && w.mesh) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', w.mesh.geometry.getAttribute('position'));
            g.setIndex(new THREE.BufferAttribute(rim, 1));
            w.outline = new THREE.LineSegments(g, w.outlineMaterial);
            w.outline.frustumCulled = false;
            w.outline.renderOrder = 3;
            w.group.add(w.outline);
        }
    }
    if (w.outline) w.outline.visible = picked;
    w.lineMaterial.color.set(picked ? PICKED_COLOR : layer.color);
    // Edges darker than the surface; full colour when the surface is hidden
    w.edgeMaterial.color.copy(color).multiplyScalar(layer.opacity > 0.001 ? 0.55 : 1);
    if (layer.showEdges && w.mesh && !w.edges) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', w.mesh.geometry.getAttribute('position'));
        g.setIndex(new THREE.BufferAttribute(edgeIndex(w.part.triangles, w.part.vertices.length / 3), 1));
        w.edges = new THREE.LineSegments(g, w.edgeMaterial);
        w.edges.frustumCulled = false;
        w.edges.renderOrder = 2;
        w.group.add(w.edges);
    }
    if (w.edges) w.edges.visible = layer.showEdges;
    // Its outline: its rim and creases in its own colour (the pick colour while it is picked)
    w.creaseMaterial.color.set(picked ? PICKED_COLOR : layer.color);
    if (layer.creases && w.mesh && w.creases === undefined) {
        const index = creaseIndex(w.part.triangles, w.part.vertices, w.part.vertices.length / 3);
        w.creases = null;
        if (index.length > 0) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', w.mesh.geometry.getAttribute('position'));
            g.setIndex(new THREE.BufferAttribute(index, 1));
            w.creases = new THREE.LineSegments(g, w.creaseMaterial);
            w.creases.frustumCulled = false;
            w.creases.renderOrder = 2;
            w.group.add(w.creases);
        }
    }
    if (w.creases) w.creases.visible = !!layer.creases;
    w.whole = !!layer.whole;
    w.onSlice = layer.onSlice ?? null;
    w.show = { mesh: !!w.mesh?.visible, edges: !!w.edges?.visible, creases: !!w.creases?.visible, outline: !!w.outline?.visible, lines: true };
    // (A section asked for filled is filled: as see-through as its faces where they are drawn, else not at all)
    w.look = { color: layer.color, picked, fill: layer.opacity > 0.001 ? layer.opacity : 1 };
}

export class ThreeViewport {
    private readonly container: HTMLElement;
    private readonly renderer: THREE.WebGLRenderer;
    private readonly labelRenderer: CSS2DRenderer;
    private readonly scene = new THREE.Scene();
    private readonly perspective: THREE.PerspectiveCamera;
    private readonly orthographic: THREE.OrthographicCamera;
    private camera: THREE.Camera & { zoom: number; updateProjectionMatrix(): void };
    private readonly controls: OrbitControls;
    private readonly resizeObserver: ResizeObserver;
    private frame = 0;

    private geometry: PointCloudGeometry | null = null;
    private readonly pointGeom = new THREE.BufferGeometry();
    private readonly pointMaterial: THREE.ShaderMaterial;
    private readonly points: THREE.Points;
    private readonly traceGroup = new THREE.Group();
    private traceLines: THREE.LineSegments | null = null;
    private readonly traceMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 });
    private readonly axesGroup = new THREE.Group();
    private readonly groundGroup = new THREE.Group();
    private groundZ = 0;
    private groundOpacity = 1;
    private vex = 1;
    private clip: ClipState | null = null;
    private background = '#ffffff';
    private flags: Float32Array | null = null;
    private hasSelection = false;
    private isolate = false;
    private styles: ViewerStyleBuffers | null = null;

    // Sample intervals as cylinders: one instanced mesh, instance i = row i
    private readonly cylinderMaterial: THREE.ShaderMaterial;
    private cylinders: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> | null = null;
    private xray = false;
    private readonly cameraListeners = new Set<() => void>();
    private intervals: IntervalGeometry | null = null;
    /** The samples are drawn (points and cylinders; the traces are apart) */
    private samplesShown = true;
    /** Some rows are drawn as points (not all as cylinders) */
    private pointsWanted = true;
    /** Logging tables down the holes: a mesh of cylinder pieces each, by table id */
    private readonly loggingGroup = new THREE.Group();
    /** `rgba` is the layer's own; the mesh draws a copy, in which the interval picked is marked */
    private readonly logMeshes = new Map<string, { mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>; start: Float32Array; rgba: Float32Array; drawn: Float32Array }>();
    /** The logging pieces marked as picked: the table's id and the pieces */
    private logMark: { id: string; pieces: number[] } | null = null;

    // Orbit pivot: the data point grabbed at the start of a rotate drag (world
    // coords) and where it sat in camera space, so it stays under the cursor.
    private pivot: THREE.Vector3 | null = null;
    private readonly pivotLocal = new THREE.Vector3();
    private lastWheel = { time: 0, x: 0, y: 0 };

    /** Outlines of the slices' mid-planes */
    private readonly sliceGroup = new THREE.Group();
    private readonly gridGroup = new THREE.Group();
    /** Holes pointed out by the hole finder: drawn over everything, never clipped */
    private readonly markerGroup = new THREE.Group();

    /**
     * The points and lines of the surface being edited, and the snap marker. They are drawn over the
     * data, but each is at its place in space: a slice that has moved away from one no longer shows it
     * (the snap marker and the outline are never cut).
     */
    private readonly handleGroup = new THREE.Group();
    private handles: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
    /** The nodes of its lines */
    private nodes: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
    private snapMarker: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
    /** Rings round the points and nodes picked out (to be given a direction together) */
    private selectedMarks: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
    private targetMarks: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
    /** Lines of the surface being edited: a dark casing, a light core, and the one pointed at */
    private editLines: LineSegments2[] = [];
    /** The places and links put on a surface by hand: dots of each side, rings round the picked, the links' lines */
    private controlDots: [THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null, THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null] = [null, null];
    private controlRings: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
    private controlLines: LineSegments2[] = [];
    /** A surface's logged contacts while they are moved by hand: as logged, moved, left out */
    private contactHandles: (THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null)[] = [null, null, null];
    /** The handles on the faces of a box being changed, and the box as it would be */
    private faces: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
    private boxLines: LineSegments2[] = [];
    private rulerLines: LineSegments2[] = [];
    private turnHandle: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
    private rulerEnds: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
    /** How far the marks of how a surface lies reach from their place (m): the slices cut them that much further out */
    private marksSlack = 0;

    private readonly wireGroup = new THREE.Group();
    private readonly wires = new Map<string, WireObject>();
    /** Local-coordinate bounds of the visible wireframes (included when fitting the view) */
    private wireBounds: { min: number[]; max: number[] } | null = null;
    /** Directional light that follows the camera (lights only affect wireframe surfaces) */
    private readonly headlight = new THREE.DirectionalLight(0xffffff, 2.2);

    /**
     * Layers added by plug-in modules (e.g. the drillhole planner), by id: in
     * local coordinates, scaled with the vertical exaggeration. Materials with
     * `userData.clipWithSlices` are cut by the clip box and slices, those with
     * `userData.clipWithBox` by the box only; others always show. The module
     * that adds a layer disposes of it.
     */
    private readonly layerGroup = new THREE.Group();
    private readonly layers = new Map<string, THREE.Object3D>();

    /** Called after the user finishes a camera interaction (to persist the view). */
    onCameraChangeEnd: (() => void) | null = null;
    /** Called on every camera movement (a slice locked to the camera follows it). */
    onCameraChange: (() => void) | null = null;
    /** Called when the browser takes the WebGL context away (lost = true) or gives it back. */
    onContextChange: ((lost: boolean) => void) | null = null;

    constructor(container: HTMLElement) {
        this.container = container;
        const { width, height } = this.size();

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(width, height);
        this.renderer.localClippingEnabled = true;
        container.appendChild(this.renderer.domElement);
        // three.js re-creates its GL state on restore with a black clear colour
        this.renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
        this.renderer.domElement.addEventListener('webglcontextrestored', this.handleContextRestored);

        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(width, height);
        Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
        container.appendChild(this.labelRenderer.domElement);

        this.perspective = new THREE.PerspectiveCamera(45, width / Math.max(height, 1), 0.1, 1e7);
        this.orthographic = new THREE.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, -1e7, 1e7);
        for (const cam of [this.perspective, this.orthographic]) cam.up.set(0, 0, 1);
        this.camera = this.perspective;

        // Registered before OrbitControls so the pivot is re-anchored on the data
        // before the controls read it.
        const canvas = this.renderer.domElement;
        canvas.addEventListener('pointerdown', this.handlePointerDown, { capture: true });
        canvas.addEventListener('pointerup', this.handlePointerUp);
        canvas.addEventListener('pointercancel', this.handlePointerUp);
        canvas.addEventListener('wheel', this.handleWheel, { capture: true, passive: true });

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = false;
        this.controls.zoomToCursor = true;
        this.controls.addEventListener('change', () => {
            this.holdPivot();
            this.updateDepthRange();
            this.requestRender();
            this.onCameraChange?.();
            for (const heard of this.cameraListeners) heard();
        });
        this.controls.addEventListener('end', () => this.onCameraChangeEnd?.());

        this.pointMaterial = new THREE.ShaderMaterial({
            vertexShader: POINT_VERTEX_SHADER,
            fragmentShader: POINT_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: true,
            uniforms: {
                uSizeScale: { value: 1 },
                uPixelRatio: { value: this.renderer.getPixelRatio() },
                uVex: { value: 1 },
                uBoxEnabled: { value: 0 },
                uBoxMin: { value: new THREE.Vector3() },
                uBoxMax: { value: new THREE.Vector3() },
                uSlabEnabled: { value: 0 },
                uSlabNormal: { value: new THREE.Vector3(1, 0, 0) },
                uSlabCenter: { value: new THREE.Vector3() },
                uSlabRange: { value: new THREE.Vector2(-1, 1) },
                uSlab2Enabled: { value: 0 },
                uSlab2Normal: { value: new THREE.Vector3(0, 1, 0) },
                uSlab2Center: { value: new THREE.Vector3() },
                uSlab2Range: { value: new THREE.Vector2(-1, 1) },
                uIsolate: { value: 0 },
                uHasSelection: { value: 0 },
                uSelectionColor: { value: new THREE.Color('#ff3d00') },
                uXray: { value: 0 },
            },
        });
        this.points = new THREE.Points(this.pointGeom, this.pointMaterial);
        this.points.frustumCulled = false;

        // The cylinders read the points' own uniform objects (clip, slab, isolate,
        // exaggeration, selection), so the two can never disagree.
        const pu = this.pointMaterial.uniforms;
        this.cylinderMaterial = new THREE.ShaderMaterial({
            vertexShader: CYLINDER_VERTEX_SHADER,
            fragmentShader: CYLINDER_FRAGMENT_SHADER,
            uniforms: {
                uVex: pu.uVex,
                uBoxEnabled: pu.uBoxEnabled, uBoxMin: pu.uBoxMin, uBoxMax: pu.uBoxMax,
                uSlabEnabled: pu.uSlabEnabled, uSlabNormal: pu.uSlabNormal, uSlabCenter: pu.uSlabCenter, uSlabRange: pu.uSlabRange,
                uSlab2Enabled: pu.uSlab2Enabled, uSlab2Normal: pu.uSlab2Normal, uSlab2Center: pu.uSlab2Center, uSlab2Range: pu.uSlab2Range,
                uIsolate: pu.uIsolate, uHasSelection: pu.uHasSelection, uSelectionColor: pu.uSelectionColor,
                uXray: pu.uXray,
                uRadius: { value: 1 },
                uSizeByAttr: { value: 1 },
                uBaseSize: { value: CYLINDER_BASE_SIZE },
                uMinPixels: { value: 0.75 }, // radius: at least 1.5 px wide
                // Round the hole, always (given, not left out: the logging shares the program, and a uniform left out
                // would keep the logging's value)
                uSide: { value: 0 },
                uViewHeight: { value: height },
                uBackground: { value: new THREE.Color(this.background) },
            },
        });
        this.scene.add(this.groundGroup, this.points, this.traceGroup, this.loggingGroup, this.axesGroup, this.wireGroup, this.sliceGroup, this.gridGroup, this.markerGroup, this.handleGroup, this.layerGroup);
        this.scene.add(new THREE.AmbientLight(0xffffff, 1.2), this.headlight);

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
        this.requestRender();
    }

    private readonly handleContextLost = () => this.onContextChange?.(true);

    private readonly handleContextRestored = () => {
        this.renderer.setClearColor(new THREE.Color(this.background), 1);
        this.onContextChange?.(false);
        this.requestRender();
    };

    // --- navigation: keep the orbit pivot on the data ---------------------------
    //
    // OrbitControls orbits a `target` that zoom-to-cursor and panning leave
    // floating in empty space, so rotating swings the data off screen and zoom
    // steps (a fraction of the target distance) shrink to nothing in front of
    // it. Before each gesture the target is moved along the view axis (no
    // visible change) to the depth of the data under the cursor; a rotate drag
    // that starts on a point then pivots about that point.

    /** Point is drawn: valid, visible, not isolated away, inside the clip. */
    private readonly isShown = (i: number): boolean => {
        const g = this.geometry;
        if (!g || !g.valid[i]) return false;
        const f = this.flags ? this.flags[i] : 1;
        if (!(f % 2)) return false;
        if (this.isolate && this.hasSelection && f < 2) return false;
        if (!this.clip) return true;
        const p = g.positions;
        return isInsideClip(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], this.clip);
    };

    private sceneRadius(): number {
        const points = this.geometry?.bounds;
        if (!points) return 1;
        // Furthest corner from the local origin: the points are centred on it
        // (half their diagonal), visible wireframes can sit off to one side.
        const b = this.sceneBounds(points);
        return Math.max(Math.hypot(
            Math.max(-b.min[0], b.max[0]),
            Math.max(-b.min[1], b.max[1]),
            Math.max(-b.min[2], b.max[2]) * this.vex,
        ), 1);
    }

    /**
     * Slide the orbit target along the view axis to the data under the cursor
     * (else the middle of what is on screen). Returns the picked point or -1.
     */
    private refocus(clientX: number, clientY: number): number {
        const g = this.geometry;
        if (!g || g.validCount === 0) return -1;
        const cam = this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
        const mvp = this.mvp();
        const forward = cam.getWorldDirection(new THREE.Vector3());
        const rect = this.renderer.domElement.getBoundingClientRect();
        const { width, height } = this.size();
        const focus = findViewFocus(
            g.positions, mvp.elements, cam.position.toArray(), forward.toArray(), this.vex,
            width, height, [clientX - rect.left, clientY - rect.top], this.isShown,
        );
        if (!focus) return -1;
        const target = this.controls.target;
        if (cam === this.orthographic) {
            // Depth does not change an orthographic view; keep the eye in front of the target
            const dist = Math.max(cam.position.distanceTo(target), 1);
            target.copy(cam.position).addScaledVector(forward, focus.depth);
            cam.position.copy(target).addScaledVector(forward, -dist);
        } else if (focus.depth > 1e-6) {
            target.copy(cam.position).addScaledVector(forward, focus.depth);
        }
        return focus.index;
    }

    private readonly handlePointerDown = (e: PointerEvent) => {
        this.pivot = null;
        if (!this.controls.enabled || !e.isPrimary) return;
        const picked = this.refocus(e.clientX, e.clientY);
        const rotating = e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey;
        if (picked < 0 || !rotating || !this.geometry) return;
        const p = this.geometry.positions;
        this.pivot = new THREE.Vector3(p[picked * 3], p[picked * 3 + 1], p[picked * 3 + 2] * this.vex);
        this.camera.updateMatrixWorld();
        this.pivotLocal.copy(this.pivot).applyMatrix4(this.camera.matrixWorldInverse);
    };

    private readonly handlePointerUp = () => { this.pivot = null; };

    private readonly handleWheel = (e: WheelEvent) => {
        if (!this.controls.enabled) return;
        // Once per wheel burst: the controls keep the target at that depth while zooming
        const now = performance.now();
        const last = this.lastWheel;
        const moved = Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y) > 4;
        this.lastWheel = { time: now, x: e.clientX, y: e.clientY };
        if (now - last.time < 200 && !moved) return;
        const picked = this.refocus(e.clientX, e.clientY);
        if (picked >= 0 || this.camera !== this.perspective) return;
        // Nothing under the cursor: never let the zoom step collapse to nothing
        const minDist = this.sceneRadius() * 0.02;
        if (this.camera.position.distanceTo(this.controls.target) < minDist) {
            const forward = this.camera.getWorldDirection(new THREE.Vector3());
            this.controls.target.copy(this.camera.position).addScaledVector(forward, minDist);
        }
    };

    /** During a rotate drag, shift the camera so the grabbed point stays put on screen. */
    private holdPivot() {
        if (!this.pivot) return;
        this.camera.updateMatrixWorld();
        const delta = this.pivotLocal.clone().applyMatrix4(this.camera.matrixWorld).sub(this.pivot).negate();
        if (delta.lengthSq() === 0) return;
        this.camera.position.add(delta);
        this.controls.target.add(delta);
    }

    /** Near/far planes follow the camera so zooming right in never clips the data. */
    private updateDepthRange() {
        if (this.camera !== this.perspective) return;
        const r = this.sceneRadius();
        const d = this.perspective.position.length(); // data is centred on the local origin
        // x3: room for the axis labels and the satellite image's margin
        const far = d + r * 3;
        const near = Math.max(d - r * 3, far * 1e-5);
        if (near === this.perspective.near && far === this.perspective.far) return;
        this.perspective.near = near;
        this.perspective.far = far;
        this.perspective.updateProjectionMatrix();
    }

    private size() {
        return { width: Math.max(this.container.clientWidth, 1), height: Math.max(this.container.clientHeight, 1) };
    }

    /** Local coordinates to clip space, the vertical exaggeration included. */
    private mvp(): THREE.Matrix4 {
        const cam = this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
        cam.updateMatrixWorld();
        return new THREE.Matrix4()
            .multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
            .multiply(new THREE.Matrix4().makeScale(1, 1, this.vex));
    }

    private resize() {
        const { width, height } = this.size();
        this.renderer.setSize(width, height);
        this.labelRenderer.setSize(width, height);
        this.perspective.aspect = width / height;
        this.perspective.updateProjectionMatrix();
        Object.assign(this.orthographic, { left: -width / 2, right: width / 2, top: height / 2, bottom: -height / 2 });
        this.orthographic.updateProjectionMatrix();
        this.cylinderMaterial.uniforms.uViewHeight.value = height;
        this.requestRender();
    }

    requestRender() {
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.renderNow();
            this.labelRenderer.render(this.scene, this.camera);
        });
    }

    private renderNow() {
        // Headlight from the camera towards the orbit target
        this.headlight.position.copy(this.camera.position);
        this.headlight.target.position.copy(this.controls.target);
        this.headlight.target.updateMatrixWorld();
        if (!this.xray) {
            this.renderer.render(this.scene, this.camera);
            return;
        }
        // Highs in front: the samples' depth is their grade rank, which means
        // nothing against a surface's real depth. So: everything else first,
        // then the samples on a cleared depth buffer (they show through the
        // surfaces and the ground), then the handles and slice frames on top.
        const samples: THREE.Object3D[] = this.cylinders ? [this.points, this.cylinders] : [this.points];
        const overlays: THREE.Object3D[] = [this.sliceGroup, this.markerGroup, this.handleGroup];
        const was = this.scene.children.map(c => c.visible);
        const only = (keep: (c: THREE.Object3D) => boolean) => {
            this.scene.children.forEach((c, i) => { c.visible = was[i] && keep(c); });
        };
        try {
            only(c => !samples.includes(c) && !overlays.includes(c));
            this.renderer.render(this.scene, this.camera);
            this.renderer.autoClear = false;
            this.renderer.clearDepth();
            only(c => samples.includes(c));
            this.renderer.render(this.scene, this.camera);
            only(c => overlays.includes(c));
            this.renderer.render(this.scene, this.camera);
        } finally {
            this.renderer.autoClear = true;
            this.scene.children.forEach((c, i) => { c.visible = was[i]; });
        }
    }

    /**
     * Highs in front (maximum intensity projection): along every line of
     * sight the sample with the highest emphasis rank is the one drawn.
     */
    setXray(on: boolean) {
        if (on === this.xray) return;
        this.xray = on;
        this.pointMaterial.uniforms.uXray.value = on ? 1 : 0;
        this.requestRender();
    }

    setBackground(color: string) {
        this.background = color;
        this.renderer.setClearColor(new THREE.Color(color), 1);
        this.cylinderMaterial.uniforms.uBackground.value.set(color);
        this.requestRender();
    }

    setInteractive(enabled: boolean) {
        this.controls.enabled = enabled;
    }

    // --- data ------------------------------------------------------------------

    setGeometry(geometry: PointCloudGeometry) {
        this.geometry = geometry;
        this.setIntervals(null); // rows changed: the cylinders are rebuilt by the next setIntervals
        this.pointGeom.setAttribute('position', new THREE.BufferAttribute(geometry.positions, 3));
        this.updateDepthRange();
        this.requestRender();
    }

    setStyles(styles: ViewerStyleBuffers) {
        this.styles = styles;
        this.pointGeom.setAttribute('color', new THREE.BufferAttribute(styles.color, 4));
        this.pointGeom.setAttribute('size', new THREE.BufferAttribute(styles.size, 1));
        this.pointGeom.setAttribute('shape', new THREE.BufferAttribute(styles.shape, 1));
        this.pointGeom.setAttribute('emph', new THREE.BufferAttribute(styles.emph, 2));
        this.linkCylinderRows();
        this.traceLines?.geometry.setAttribute('color', new THREE.BufferAttribute(styles.color, 4));
        this.requestRender();
    }

    setFlags(flags: Float32Array, hasSelection: boolean) {
        this.flags = flags;
        this.hasSelection = hasSelection;
        this.pointGeom.setAttribute('flags', new THREE.BufferAttribute(flags, 1));
        this.pointMaterial.uniforms.uHasSelection.value = hasSelection ? 1 : 0;
        this.linkCylinderRows();
        this.requestRender();
    }

    // --- sample intervals as cylinders ---------------------------------------------

    /**
     * Draw each row's From-To interval as a cylinder (null: back to points).
     * Rows with an interval are then left out of the points; the rest (surface
     * samples, rows with no length) stay as points.
     */
    setIntervals(intervals: IntervalGeometry | null) {
        if (this.cylinders) {
            this.scene.remove(this.cylinders);
            this.cylinders.geometry.dispose();
            this.cylinders = null;
        }
        this.intervals = null;
        const g = this.geometry;
        if (!intervals || !g || intervals.has.length * 3 !== g.positions.length) {
            this.pointGeom.setIndex(null);
            this.pointsWanted = true;
            this.points.visible = this.samplesShown;
            this.requestRender();
            return;
        }
        this.intervals = intervals;
        const rows = intervals.has.length;
        // Fewer sides on very large datasets (each row is one cylinder)
        const template = cylinderTemplate(rows <= 100_000 ? 12 : rows <= 400_000 ? 8 : 6);
        const geom = new THREE.InstancedBufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(template.position, 3));
        geom.setAttribute('normal', new THREE.BufferAttribute(template.normal, 3));
        geom.setIndex(new THREE.BufferAttribute(template.index, 1));
        geom.setAttribute('iStart', new THREE.InstancedBufferAttribute(intervals.start, 3));
        geom.setAttribute('iEnd', new THREE.InstancedBufferAttribute(intervals.end, 3));
        geom.setAttribute('iMid', new THREE.InstancedBufferAttribute(g.positions, 3));
        geom.instanceCount = rows;
        this.cylinders = new THREE.Mesh(geom, this.cylinderMaterial);
        this.cylinders.frustumCulled = false;
        this.cylinders.visible = this.samplesShown;
        this.linkCylinderRows();
        this.scene.add(this.cylinders);

        const pointRows = rowsWithoutInterval(intervals.has);
        this.pointGeom.setIndex(new THREE.BufferAttribute(pointRows, 1));
        this.pointsWanted = pointRows.length > 0;
        this.points.visible = this.pointsWanted && this.samplesShown;
        this.requestRender();
    }

    /** Draw the samples (points and cylinders) or not; the traces through them stay as they are */
    setSamplesShown(shown: boolean) {
        if (shown === this.samplesShown) return;
        this.samplesShown = shown;
        this.points.visible = this.pointsWanted && shown;
        if (this.cylinders) this.cylinders.visible = shown;
        this.requestRender();
    }

    /** Per-row colour / size / flags of the cylinders: the same arrays the points use. */
    private linkCylinderRows() {
        const geom = this.cylinders?.geometry;
        if (!geom) return;
        const rows = geom.instanceCount;
        if (this.styles && this.styles.size.length === rows) {
            geom.setAttribute('color', new THREE.InstancedBufferAttribute(this.styles.color, 4));
            geom.setAttribute('size', new THREE.InstancedBufferAttribute(this.styles.size, 1));
            geom.setAttribute('emph', new THREE.InstancedBufferAttribute(this.styles.emph, 2));
        }
        if (this.flags && this.flags.length === rows) {
            geom.setAttribute('flags', new THREE.InstancedBufferAttribute(this.flags, 1));
        }
    }

    /** Row of the front-most cylinder under a CSS-pixel position (-1: none, or cylinders are off). */
    pickCylinder(x: number, y: number, eligible: (i: number) => boolean): number {
        if (!this.cylinders || !this.intervals) return -1;
        const cam = this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
        const mvp = this.mvp();
        const { width, height } = this.size();
        const u = this.cylinderMaterial.uniforms;
        const sizes = u.uSizeByAttr.value ? this.styles?.size : undefined;
        const radius = u.uRadius.value as number;
        return pickInterval(
            this.intervals, mvp.elements, width, height, [x, y],
            i => (sizes ? radius * sizes[i] / CYLINDER_BASE_SIZE : radius),
            cam.projectionMatrix.elements[5] * height / 2, cam === this.perspective, eligible,
            u.uMinPixels.value as number, 3, this.xrayRanks(),
        );
    }

    /** Each row's emphasis rank and fade (two per row) while highs are drawn in front, else null: what a click should then prefer. */
    xrayRanks(): Float32Array | null {
        return this.xray && this.styles ? this.styles.emph : null;
    }

    // --- logging tables down the holes ----------------------------------------------

    /**
     * Draw logging tables as cylinder pieces down the holes (loggingDisplay):
     * one mesh each, built again only when its pieces or colours change. They
     * are cut by the clip box and slices as the samples are, never isolated
     * or faded with them.
     */
    setLogging(layers: readonly { id: string; start: Float32Array; end: Float32Array; mid: Float32Array; rgba: Float32Array; width: number; side?: number }[]) {
        const wanted = new Set(layers.map(l => l.id));
        const drop = (id: string) => {
            const m = this.logMeshes.get(id);
            if (!m) return;
            this.loggingGroup.remove(m.mesh);
            m.mesh.geometry.dispose();
            m.mesh.material.dispose();
            this.logMeshes.delete(id);
        };
        for (const id of [...this.logMeshes.keys()]) if (!wanted.has(id)) drop(id);
        for (const l of layers) {
            let m = this.logMeshes.get(l.id);
            if (m && (m.start !== l.start || m.rgba !== l.rgba)) {
                drop(l.id);
                m = undefined;
            }
            if (!m) {
                const n = l.start.length / 3;
                if (n === 0) continue;
                const template = cylinderTemplate(n <= 100_000 ? 12 : 8);
                const geom = new THREE.InstancedBufferGeometry();
                geom.setAttribute('position', new THREE.BufferAttribute(template.position, 3));
                geom.setAttribute('normal', new THREE.BufferAttribute(template.normal, 3));
                geom.setIndex(new THREE.BufferAttribute(template.index, 1));
                geom.setAttribute('iStart', new THREE.InstancedBufferAttribute(l.start, 3));
                geom.setAttribute('iEnd', new THREE.InstancedBufferAttribute(l.end, 3));
                geom.setAttribute('iMid', new THREE.InstancedBufferAttribute(l.mid, 3));
                const drawn = l.rgba.slice();
                geom.setAttribute('color', new THREE.InstancedBufferAttribute(drawn, 4));
                geom.setAttribute('size', new THREE.InstancedBufferAttribute(new Float32Array(n).fill(CYLINDER_BASE_SIZE), 1));
                geom.setAttribute('flags', new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1));
                const emph = new Float32Array(n * 2);
                for (let k = 0; k < n; k++) emph[k * 2 + 1] = 1;
                geom.setAttribute('emph', new THREE.InstancedBufferAttribute(emph, 2));
                geom.instanceCount = n;
                const mesh = new THREE.Mesh(geom, this.loggingMaterial());
                mesh.frustumCulled = false;
                this.loggingGroup.add(mesh);
                m = { mesh, start: l.start, rgba: l.rgba, drawn };
                this.logMeshes.set(l.id, m);
                if (this.logMark?.id === l.id) this.paintMark(m, this.logMark.pieces, true);
            }
            m.mesh.material.uniforms.uRadius.value = Math.max(l.width, 0) / 2;
            m.mesh.material.uniforms.uSide.value = Math.max(l.side ?? 0, 0);
        }
        this.requestRender();
    }

    /** Mark pieces of a logging table as picked (null: none). The mark stays through a rebuild of the table's mesh. */
    markLogging(mark: { id: string; pieces: number[] } | null) {
        const old = this.logMark;
        if (old) {
            const m = this.logMeshes.get(old.id);
            if (m) this.paintMark(m, old.pieces, false);
        }
        this.logMark = mark && mark.pieces.length ? mark : null;
        if (this.logMark) {
            const m = this.logMeshes.get(this.logMark.id);
            if (m) this.paintMark(m, this.logMark.pieces, true);
        }
        this.requestRender();
    }

    private paintMark(m: { mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>; rgba: Float32Array; drawn: Float32Array }, pieces: readonly number[], on: boolean) {
        // As the samples' colours are given to the shader: as written, not in three's linear colour space
        const pick = parseCssColor(PICKED_COLOR);
        for (const k of pieces) {
            if (k < 0 || k * 4 + 3 >= m.drawn.length) continue;
            if (on) m.drawn.set([pick[0], pick[1], pick[2], 1], k * 4);
            else m.drawn.set(m.rgba.subarray(k * 4, k * 4 + 4), k * 4);
        }
        m.mesh.geometry.getAttribute('color').needsUpdate = true;
    }

    /**
     * The logging piece under a CSS-pixel position, nearest the eye of all the
     * tables drawn (null: none). `eligible` says whether a piece is drawn
     * (inside the clip box and slices).
     */
    pickLogging(x: number, y: number, eligible: (id: string, piece: number) => boolean): { id: string; piece: number } | null {
        if (this.logMeshes.size === 0) return null;
        const cam = this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
        const mvp = this.mvp().elements;
        const { width, height } = this.size();
        const perspective = cam === this.perspective;
        const pxScale = cam.projectionMatrix.elements[5] * height / 2;
        let best: { id: string; piece: number } | null = null;
        let bestDepth = Infinity;
        for (const [id, m] of this.logMeshes) {
            const g = m.mesh.geometry;
            const start = g.getAttribute('iStart').array as Float32Array, end = g.getAttribute('iEnd').array as Float32Array;
            const mid = g.getAttribute('iMid').array as Float32Array;
            const n = g.instanceCount;
            const radius = m.mesh.material.uniforms.uRadius.value as number;
            const side = m.mesh.material.uniforms.uSide.value as number;
            const ends = side > 0 ? this.besideEnds(start, end, mid, side, radius, m.mesh.material.uniforms.uMinPixels.value as number) : { start, end };
            const k = pickInterval(
                { start: ends.start, end: ends.end, has: new Uint8Array(n).fill(1), count: n, medianLength: 0 }, mvp, width, height, [x, y],
                () => radius, pxScale, perspective, i => eligible(id, i), m.mesh.material.uniforms.uMinPixels.value as number,
            );
            if (k < 0) continue;
            // How far from the eye its middle is drawn (the matrix exaggerates the heights)
            const px = mid[k * 3], py = mid[k * 3 + 1], pz = mid[k * 3 + 2];
            const w = mvp[3] * px + mvp[7] * py + mvp[11] * pz + mvp[15];
            const depth = perspective ? w : (mvp[2] * px + mvp[6] * py + mvp[10] * pz + mvp[14]) / w;
            if (depth < bestDepth) { bestDepth = depth; best = { id, piece: k }; }
        }
        return best;
    }

    /**
     * The ends of pieces drawn beside their hole (as the cylinders' shader puts them: to the right of the hole on the
     * screen, `side` plus their own radius from its middle), in local coordinates, for picking them where they are seen
     */
    private besideEnds(start: Float32Array, end: Float32Array, mid: Float32Array, side: number, radius: number, minPixels: number): { start: Float32Array; end: Float32Array } {
        const cam = this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
        cam.updateMatrixWorld();
        const e = cam.matrixWorld.elements;
        const right = [e[0], e[1], e[2]], up = [e[4], e[5], e[6]], eye = [e[12], e[13], e[14]], back = [e[8], e[9], e[10]];
        const vex = this.vex, perspective = cam === this.perspective;
        const pxScale = cam.projectionMatrix.elements[5] * this.size().height / 2;
        const s2 = new Float32Array(start.length), e2 = new Float32Array(end.length);
        for (let k = 0; k < start.length; k += 3) {
            const a = [end[k] - start[k], end[k + 1] - start[k + 1], (end[k + 2] - start[k + 2]) * vex];
            const ax = a[0] * right[0] + a[1] * right[1] + a[2] * right[2], ay = a[0] * up[0] + a[1] * up[1] + a[2] * up[2];
            const len = Math.hypot(ax, ay);
            const sx = len > 1e-9 ? -ay / len : 1, sy = len > 1e-9 ? ax / len : 0;
            // Metres to pixels where the piece is
            const depth = perspective
                ? Math.max(1e-6, (eye[0] - mid[k]) * back[0] + (eye[1] - mid[k + 1]) * back[1] + (eye[2] - mid[k + 2] * vex) * back[2])
                : 1;
            const pxPerMetre = pxScale / depth;
            const off = Math.max(side, 1 / pxPerMetre) + Math.max(radius, minPixels / pxPerMetre);
            const dx = (sx * right[0] + sy * up[0]) * off, dy = (sx * right[1] + sy * up[1]) * off, dz = (sx * right[2] + sy * up[2]) * off / vex;
            s2[k] = start[k] + dx; s2[k + 1] = start[k + 1] + dy; s2[k + 2] = start[k + 2] + dz;
            e2[k] = end[k] + dx; e2[k + 1] = end[k + 1] + dy; e2[k + 2] = end[k + 2] + dz;
        }
        return { start: s2, end: e2 };
    }

    /** The logging tables drawn, by id (for checks) */
    loggingDrawn(): { id: string; pieces: number; radius: number; side: number }[] {
        return [...this.logMeshes].map(([id, m]) => ({ id, pieces: m.mesh.geometry.instanceCount, radius: m.mesh.material.uniforms.uRadius.value as number, side: m.mesh.material.uniforms.uSide.value as number }));
    }

    /** The cylinders' shader with the samples' clip, slices and exaggeration, and nothing of their selection, isolation or emphasis */
    private loggingMaterial(): THREE.ShaderMaterial {
        const pu = this.pointMaterial.uniforms, cu = this.cylinderMaterial.uniforms;
        return new THREE.ShaderMaterial({
            vertexShader: CYLINDER_VERTEX_SHADER,
            fragmentShader: CYLINDER_FRAGMENT_SHADER,
            uniforms: {
                uVex: pu.uVex,
                uBoxEnabled: pu.uBoxEnabled, uBoxMin: pu.uBoxMin, uBoxMax: pu.uBoxMax,
                uSlabEnabled: pu.uSlabEnabled, uSlabNormal: pu.uSlabNormal, uSlabCenter: pu.uSlabCenter, uSlabRange: pu.uSlabRange,
                uSlab2Enabled: pu.uSlab2Enabled, uSlab2Normal: pu.uSlab2Normal, uSlab2Center: pu.uSlab2Center, uSlab2Range: pu.uSlab2Range,
                uIsolate: { value: 0 }, uHasSelection: { value: 0 }, uSelectionColor: pu.uSelectionColor,
                uXray: { value: 0 },
                uRadius: { value: 1 },
                uSizeByAttr: { value: 0 },
                uBaseSize: { value: CYLINDER_BASE_SIZE },
                uMinPixels: { value: 1 },
                uSide: { value: 0 },
                uViewHeight: cu.uViewHeight,
                uBackground: cu.uBackground,
            },
        });
    }

    /** `width` is the cylinder diameter in metres; `sizeByAttribute` scales it by each row's Size. */
    setCylinderStyle(opts: { width: number; sizeByAttribute: boolean }) {
        const u = this.cylinderMaterial.uniforms;
        u.uRadius.value = Math.max(opts.width, 0) / 2;
        u.uSizeByAttr.value = opts.sizeByAttribute ? 1 : 0;
        this.requestRender();
    }

    setTraces(segments: DrillholeSegments | null, styles: ViewerStyleBuffers | null) {
        if (this.traceLines) {
            this.traceGroup.remove(this.traceLines);
            this.traceLines.geometry.dispose();
            this.traceLines = null;
        }
        if (segments && this.geometry && styles) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.BufferAttribute(this.geometry.positions, 3));
            g.setAttribute('color', new THREE.BufferAttribute(styles.color, 4));
            g.setIndex(new THREE.BufferAttribute(segments.pairs, 1));
            this.traceLines = new THREE.LineSegments(g, this.traceMaterial);
            this.traceLines.frustumCulled = false;
            this.traceGroup.add(this.traceLines);
        }
        this.requestRender();
    }

    setDisplay(opts: { sizeScale: number; vex: number; isolate: boolean; selectionColor: string }) {
        const u = this.pointMaterial.uniforms;
        u.uSizeScale.value = opts.sizeScale;
        u.uVex.value = opts.vex;
        u.uIsolate.value = opts.isolate ? 1 : 0;
        u.uSelectionColor.value.set(opts.selectionColor);
        this.vex = opts.vex;
        this.isolate = opts.isolate;
        this.traceGroup.scale.set(1, 1, opts.vex);
        this.groundGroup.position.z = this.groundZ * opts.vex;
        this.wireGroup.scale.set(1, 1, opts.vex);
        this.sliceGroup.scale.set(1, 1, opts.vex);
        this.gridGroup.scale.set(1, 1, opts.vex);
        this.markerGroup.scale.set(1, 1, opts.vex);
        this.handleGroup.scale.set(1, 1, opts.vex);
        this.layerGroup.scale.set(1, 1, opts.vex);
        if (this.clip) this.traceMaterial.clippingPlanes = clipPlanes(this.clip, this.vex);
        this.applyWireClip();
        this.applyLayerClip();
        this.applyHandleClip();
        this.updateDepthRange();
        this.requestRender();
    }

    setClip(clip: ClipState) {
        this.clip = clip;
        const u = this.pointMaterial.uniforms;
        u.uBoxEnabled.value = clip.boxEnabled ? 1 : 0;
        u.uBoxMin.value.set(...clip.boxMin);
        u.uBoxMax.value.set(...clip.boxMax);
        const [a, b] = clip.slabs;
        u.uSlabEnabled.value = a ? 1 : 0;
        if (a) {
            u.uSlabNormal.value.set(...a.normal);
            u.uSlabCenter.value.set(...a.center);
            u.uSlabRange.value.set(a.lo, a.hi);
        }
        u.uSlab2Enabled.value = b ? 1 : 0;
        if (b) {
            u.uSlab2Normal.value.set(...b.normal);
            u.uSlab2Center.value.set(...b.center);
            u.uSlab2Range.value.set(b.lo, b.hi);
        }
        // Recompile only when the number of planes changes: moving a slice is then free
        const planes = clipPlanes(clip, this.vex);
        if ((this.traceMaterial.clippingPlanes?.length ?? 0) !== planes.length) this.traceMaterial.needsUpdate = true;
        this.traceMaterial.clippingPlanes = planes;
        this.applyWireClip();
        this.applyHandleClip();
        this.applyLayerClip();
        this.requestRender();
    }

    /** Add, replace (same id) or remove (null) a plug-in layer; see `layerGroup`. */
    setLayer(id: string, object: THREE.Object3D | null) {
        const old = this.layers.get(id);
        if (old) {
            this.layerGroup.remove(old);
            this.layers.delete(id);
        }
        if (object) {
            this.layers.set(id, object);
            this.layerGroup.add(object);
        }
        this.applyLayerClip();
        this.requestRender();
    }

    private applyLayerClip() {
        const planes = this.clip ? clipPlanes(this.clip, this.vex) : [];
        // `clipWithBox`: cut by the clip box only (e.g. a faded copy showing what lies off the slices)
        const boxPlanes = this.clip ? clipPlanes({ ...this.clip, slabs: [] }, this.vex) : [];
        this.layerGroup.traverse(o => {
            const mat = (o as THREE.Object3D & { material?: THREE.Material | THREE.Material[] }).material;
            for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
                const use = m.userData.clipWithSlices ? planes : m.userData.clipWithBox ? boxPlanes : null;
                if (!use) continue;
                if ((m.clippingPlanes?.length ?? 0) !== use.length) m.needsUpdate = true;
                m.clippingPlanes = use;
            }
        });
    }

    /** Thin outlines showing where each slice's mid-plane sits (empty list: none). */
    setSliceFrames(frames: SliceFrame[]) {
        for (const child of [...this.sliceGroup.children] as THREE.LineLoop[]) {
            this.sliceGroup.remove(child);
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
        }
        for (const f of frames) {
            if (f.corners.length < 9) continue;
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(f.corners), 3));
            const loop = new THREE.LineLoop(geom, new THREE.LineBasicMaterial({ color: f.color, transparent: true, opacity: 0.85 }));
            loop.frustumCulled = false;
            this.sliceGroup.add(loop);
        }
        this.requestRender();
    }

    /** A grid drawn on a section's plane, with its coordinates (null: none). */
    setPlaneGrid(grid: PlaneGrid | null) {
        for (const child of [...this.gridGroup.children]) {
            this.gridGroup.remove(child);
            if (child instanceof THREE.LineSegments) {
                child.geometry.dispose();
                (child.material as THREE.Material).dispose();
            } else if (child instanceof CSS2DObject) child.element.remove();
        }
        if (grid && grid.lines.length >= 6) {
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(grid.lines), 3));
            const lines = new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: grid.color, transparent: true, opacity: 0.35, depthWrite: false }));
            lines.frustumCulled = false;
            this.gridGroup.add(lines);
            for (const l of grid.labels) {
                const el = document.createElement('div');
                el.textContent = l.text;
                el.dataset.grid = '1';
                Object.assign(el.style, { color: grid.color, font: '400 11px Inter, system-ui, sans-serif', whiteSpace: 'nowrap', textShadow: '0 0 3px rgba(0,0,0,0.15)' });
                const obj = new CSS2DObject(el);
                obj.position.set(...l.p);
                this.gridGroup.add(obj);
            }
        }
        this.requestRender();
    }

    /** The box outline and its tick labels shown or not (a section's grid takes their place) */
    setAxesVisible(on: boolean) {
        if (this.axesGroup.visible === on) return;
        this.axesGroup.visible = on;
        this.requestRender();
    }

    /** Turning the view by dragging allowed or not (panning and zooming stay) */
    setRotatable(on: boolean) {
        this.controls.enableRotate = on;
    }

    /** Move the camera and what it looks at by `d` (local coordinates, true elevation): the view slides without turning */
    shiftView(d: ArrayLike<number>) {
        const v = new THREE.Vector3(d[0], d[1], d[2] * this.vex);
        this.camera.position.add(v);
        this.controls.target.add(v);
        this.controls.update();
        this.updateDepthRange();
        this.requestRender();
        this.onCameraChangeEnd?.();
    }

    /**
     * Point holes out: each with its name on a tag at the top and, when asked
     * (`line`), a thick line along its path. Both are drawn over everything else
     * and never cut by the slices, so a hole can be found wherever it is (empty
     * list: none).
     */
    setHoleMarkers(markers: HoleMarker[]) {
        for (const child of [...this.markerGroup.children]) {
            this.markerGroup.remove(child);
            if (child instanceof Line2) {
                child.geometry.dispose();
                child.material.dispose();
            } else if (child instanceof CSS2DObject) {
                child.element.remove();
            }
        }
        for (const m of markers) {
            const count = Math.floor(m.path.length / 3);
            if (count === 0) continue;
            const drawLine = m.line && count >= 2;
            if (drawLine) {
                const geom = new LineGeometry();
                geom.setPositions(m.path);
                const line = new Line2(geom, new LineMaterial({
                    color: m.color, linewidth: m.faint ? 3 : 5, transparent: true, opacity: m.faint ? 0.6 : 0.95,
                    depthTest: false, depthWrite: false,
                }));
                line.renderOrder = 10;
                line.frustumCulled = false;
                this.markerGroup.add(line);
            }
            const el = document.createElement('div');
            el.textContent = m.label;
            el.dataset.holeMarker = m.faint ? 'hover' : 'found';
            el.dataset.holeLine = drawLine ? '1' : '0';
            Object.assign(el.style, {
                font: '600 11px Inter, system-ui, sans-serif', whiteSpace: 'nowrap', color: '#fff', background: m.color,
                padding: '1px 6px', borderRadius: '9px', opacity: m.faint ? '0.8' : '1',
                // Sits just above the top of the hole
                marginTop: '-14px',
            });
            const dismiss = m.onDismiss;
            if (dismiss) {
                // A small × on the tag takes it away (the label layer itself lets the mouse through)
                const close = document.createElement('span');
                close.textContent = '×';
                close.title = 'Remove this tag';
                close.dataset.dismiss = '1';
                Object.assign(close.style, { marginLeft: '5px', cursor: 'pointer', pointerEvents: 'auto', fontSize: '13px', lineHeight: '1' });
                const swallow = (e: Event) => e.stopPropagation(); // not also a click on the data underneath
                close.addEventListener('pointerdown', swallow);
                close.addEventListener('pointerup', swallow);
                close.addEventListener('click', e => { e.stopPropagation(); dismiss(); });
                el.appendChild(close);
            }
            const label = new CSS2DObject(el);
            label.position.set(m.path[0], m.path[1], m.path[2]);
            this.markerGroup.add(label);
        }
        this.requestRender();
    }

    // --- handles ------------------------------------------------------------------

    private handlePoints(kind: 'dot' | 'square' | 'ring' | 'box'): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
        const points = new THREE.Points(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
            vertexShader: HANDLE_VERTEX_SHADER, fragmentShader: HANDLE_FRAGMENT_SHADER,
            uniforms: {
                uColor: { value: new THREE.Color() }, uHollow: { value: kind === 'ring' || kind === 'box' ? 1 : 0 }, uSquare: { value: kind === 'square' || kind === 'box' ? 1 : 0 },
                uPixelRatio: { value: this.renderer.getPixelRatio() },
            },
            depthTest: false, depthWrite: false, transparent: true, clipping: true,
        }));
        points.frustumCulled = false;
        points.renderOrder = kind === 'ring' ? 23 : kind === 'square' ? 21 : kind === 'box' ? 20 : 22;
        this.handleGroup.add(points);
        return points;
    }

    /** The slices cut the points, the nodes and the lines of the surface being edited, as they cut the data. */
    private applyHandleClip() {
        const planes = this.clip ? clipPlanes(loosenClip(this.clip, EDGE_SLACK), this.vex) : [];
        const cut = (m: THREE.Material | undefined) => {
            if (!m) return;
            if ((m.clippingPlanes?.length ?? 0) !== planes.length) m.needsUpdate = true;
            m.clippingPlanes = planes;
        };
        cut(this.handles?.material);
        cut(this.nodes?.material);
        cut(this.selectedMarks?.material);
        cut(this.targetMarks?.material);
        cut(this.controlDots[0]?.material);
        cut(this.controlDots[1]?.material);
        cut(this.controlRings?.material);
        for (const p of this.contactHandles) cut(p?.material);
        for (const line of this.controlLines) cut(line.material);
        for (const line of this.editLines) if (!line.userData.free && !line.userData.marks) cut(line.material);
        // A mark stands out from its place (a ribbon runs across the slice its line is on): it is shown whole while its place is
        const wider = this.clip ? clipPlanes(loosenClip(this.clip, EDGE_SLACK + this.marksSlack), this.vex) : [];
        for (const line of this.editLines) {
            if (!line.userData.marks) continue;
            if ((line.material.clippingPlanes?.length ?? 0) !== wider.length) line.material.needsUpdate = true;
            line.material.clippingPlanes = wider;
        }
    }

    private showMarks(which: 'handles' | 'nodes', set: HandleSet | null, sizes: [number, number, number]) {
        if (!set || set.positions.length === 0) {
            const now = this[which];
            if (now) now.visible = false;
            this.requestRender();
            return;
        }
        const h = this[which] ?? (this[which] = this.handlePoints(which === 'nodes' ? 'square' : 'dot'));
        const count = set.positions.length / 3;
        const size = new Float32Array(count).fill(set.quiet ? sizes[0] : sizes[1]);
        if (set.active >= 0 && set.active < count) size[set.active] = sizes[2];
        h.geometry.setAttribute('position', new THREE.BufferAttribute(set.positions, 3));
        h.geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
        h.material.uniforms.uColor.value.set(set.color);
        h.visible = true;
        this.applyHandleClip();
        this.requestRender();
    }

    /** Show the control points of a surface as dots, each at its place in space (null: none). */
    setHandles(set: HandleSet | null) {
        this.showMarks('handles', set, [7, 11, 16]);
    }

    /**
     * A box that can be changed: a handle at the middle of each face (local
     * xyz; null: none), and, while one is dragged, the box as it would be
     * (`lines`: its edges, each a pair of ends). Drawn over everything, and
     * whole whatever the slices: the box is the model's, not a thing on a slice.
     */
    setBoxEdit(set: HandleSet | null, lines: ArrayLike<number> | null = null) {
        for (const line of this.boxLines) {
            this.handleGroup.remove(line);
            line.geometry.dispose();
            line.material.dispose();
        }
        this.boxLines = [];
        if (set && lines && lines.length >= 6) {
            for (const [color, width, order] of [['#1a1a1a', 4.5, 14], [set.color, 2.2, 15]] as const) {
                const geom = new LineSegmentsGeometry();
                geom.setPositions(lines instanceof Float32Array ? lines : Float32Array.from(lines));
                const line = new LineSegments2(geom, new LineMaterial({ color, linewidth: width, depthTest: false, depthWrite: false, transparent: true }));
                line.renderOrder = order;
                line.frustumCulled = false;
                this.handleGroup.add(line);
                this.boxLines.push(line);
            }
        }
        if (!set || set.positions.length === 0) {
            if (this.faces) this.faces.visible = false;
            this.requestRender();
            return;
        }
        const h = this.faces ?? (this.faces = this.handlePoints('square'));
        const count = set.positions.length / 3;
        const size = new Float32Array(count).fill(12);
        if (set.active >= 0 && set.active < count) size[set.active] = 18;
        h.geometry.setAttribute('position', new THREE.BufferAttribute(set.positions, 3));
        h.geometry.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
        h.material.uniforms.uColor.value.set(set.color);
        h.material.clippingPlanes = [];
        h.visible = true;
        this.requestRender();
    }

    /** Show the nodes of a surface's lines as small squares, each at its place in space (null: none). */
    setLineNodes(set: HandleSet | null) {
        this.showMarks('nodes', set, [5, 9, 14]);
    }

    /**
     * Show the lines of the surface being edited: `segments` is every stretch
     * as a pair of ends (local xyz, 6 numbers each), `active` the same for the
     * line pointed at or being drawn (null or empty: none). Both are at their
     * place in space, cut by the slices; `free` is drawn whole whatever the
     * slices (the outline a surface is kept inside); `marks` (the same) are
     * how it lies where that was given: discs, ribbons, directions, reaching
     * up to `marksReach` (m) from their places.
     */
    setEditLines(
        segments: ArrayLike<number> | null, active: ArrayLike<number> | null = null, free: ArrayLike<number> | null = null,
        marks: ArrayLike<number> | null = null, marksReach = 0,
    ) {
        this.marksSlack = Math.max(0, marksReach);
        for (const line of this.editLines) {
            this.handleGroup.remove(line);
            line.geometry.dispose();
            line.material.dispose();
        }
        this.editLines = [];
        const add = (positions: ArrayLike<number> | null, color: string, width: number, order: number, isFree = false, isMarks = false) => {
            if (!positions || positions.length < 6) return;
            const geom = new LineSegmentsGeometry();
            geom.setPositions(positions instanceof Float32Array ? positions : Float32Array.from(positions));
            const line = new LineSegments2(geom, new LineMaterial({ color, linewidth: width, depthTest: false, depthWrite: false, transparent: true }));
            line.renderOrder = order;
            line.frustumCulled = false;
            line.userData.free = isFree;
            line.userData.marks = isMarks;
            this.handleGroup.add(line);
            this.editLines.push(line);
        };
        add(free, '#1a1a1a', 5, 14, true);
        add(free, '#ffffff', 2.5, 15, true);
        add(segments, '#1a1a1a', 5, 16);
        add(segments, '#ffffff', 2.5, 17);
        add(marks, '#1a1a1a', 4.5, 16, false, true);
        add(marks, '#26c6da', 2, 17, false, true);
        add(active, '#1a1a1a', 6, 18);
        add(active, '#ffc107', 3.5, 19);
        this.applyHandleClip();
        this.requestRender();
    }

    /** The handle on the rim of the dip disc picked out, by which it is turned (local xyz; null: none) */
    setTurnHandle(position: ArrayLike<number> | null) {
        if (!position) {
            if (this.turnHandle) this.turnHandle.visible = false;
            this.requestRender();
            return;
        }
        const m = this.turnHandle ?? (this.turnHandle = this.handlePoints('dot'));
        m.geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from([position[0], position[1], position[2]]), 3));
        m.geometry.setAttribute('aSize', new THREE.BufferAttribute(Float32Array.from([13]), 1));
        m.material.uniforms.uColor.value.set('#26c6da');
        m.renderOrder = 23;
        m.visible = true;
        this.requestRender();
    }

    /**
     * The ruler: a line between two places (local xyz, six numbers) with a dot
     * at each end, or the one place there is so far (three numbers); null:
     * none. It is drawn whole and on top, whatever the slices.
     */
    setRuler(points: ArrayLike<number> | null) {
        for (const line of this.rulerLines) {
            this.handleGroup.remove(line);
            line.geometry.dispose();
            line.material.dispose();
        }
        this.rulerLines = [];
        if (!points || points.length < 3) {
            if (this.rulerEnds) this.rulerEnds.visible = false;
            this.requestRender();
            return;
        }
        if (points.length >= 6) {
            for (const [color, width, order] of [['#1a1a1a', 5.5, 24], ['#ffeb3b', 2.5, 25]] as const) {
                const geom = new LineSegmentsGeometry();
                geom.setPositions(Float32Array.from(Array.from(points).slice(0, 6)));
                const line = new LineSegments2(geom, new LineMaterial({ color, linewidth: width, depthTest: false, depthWrite: false, transparent: true }));
                line.renderOrder = order;
                line.frustumCulled = false;
                this.handleGroup.add(line);
                this.rulerLines.push(line);
            }
        }
        const m = this.rulerEnds ?? (this.rulerEnds = this.handlePoints('dot'));
        const n = points.length >= 6 ? 2 : 1;
        m.geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(Array.from(points).slice(0, n * 3)), 3));
        m.geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(n).fill(11), 1));
        m.material.uniforms.uColor.value.set('#ffeb3b');
        m.renderOrder = 26;
        m.visible = true;
        this.requestRender();
    }

    /** A ring round each point and node picked out (local xyz triples; null or empty: none). */
    setSelectedMarks(positions: Float32Array | null) {
        if (!positions || positions.length < 3) {
            if (this.selectedMarks) this.selectedMarks.visible = false;
            this.requestRender();
            return;
        }
        const m = this.selectedMarks ?? (this.selectedMarks = this.handlePoints('ring'));
        m.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        m.geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(positions.length / 3).fill(21), 1));
        m.material.uniforms.uColor.value.set('#ffc107');
        m.visible = true;
        this.applyHandleClip();
        this.requestRender();
    }

    /**
     * The places and links put on a surface by hand (`ControlSet`): a place a dot, a link its line with a dot at each
     * end, in its side's colour; the picked with a ring (a link a light casing as well), the one pointed at larger. A
     * size on the screen whatever the zoom, each at its place in space: the slices cut them as they cut the data.
     */
    setControls(set: ControlSet | null) {
        for (const line of this.controlLines) {
            this.handleGroup.remove(line);
            line.geometry.dispose();
            line.material.dispose();
        }
        this.controlLines = [];
        const hide = () => {
            for (const p of [this.controlDots[0], this.controlDots[1], this.controlRings]) if (p) p.visible = false;
        };
        if (!set || (set.dots.length < 3 && set.links.length < 6)) {
            hide();
            this.requestRender();
            return;
        }
        const addLines = (positions: number[], color: string, width: number, order: number) => {
            if (positions.length < 6) return;
            const geom = new LineSegmentsGeometry();
            geom.setPositions(Float32Array.from(positions));
            const line = new LineSegments2(geom, new LineMaterial({ color, linewidth: width, depthTest: false, depthWrite: false, transparent: true }));
            line.renderOrder = order;
            line.frustumCulled = false;
            this.handleGroup.add(line);
            this.controlLines.push(line);
        };
        const nLinks = Math.floor(set.links.length / 6);
        const lit: number[] = [];
        ([1, -1] as const).forEach((side, k) => {
            const segs: number[] = [];
            for (let i = 0; i < nLinks; i++) {
                if (set.linkSide[i] !== side) continue;
                const seg = Array.from(set.links.subarray(i * 6, i * 6 + 6));
                segs.push(...seg);
                if (set.linkPicked[i] || i === set.hotLink) lit.push(...seg);
            }
            addLines(segs, '#1a1a1a', set.quiet ? 3 : 4.5, 16 + k * 2);
            addLines(segs, set.colors[side], set.quiet ? 1.5 : 2.5, 17 + k * 2);
        });
        addLines(lit, '#ffc107', 7, 15);
        // The dots, a set of points a side (each its colour)
        const nDots = Math.floor(set.dots.length / 3);
        const rings: number[] = [];
        ([1, -1] as const).forEach((side, k) => {
            const at: number[] = [], size: number[] = [];
            for (let i = 0; i < nDots; i++) {
                if (set.dotSide[i] !== side) continue;
                const p = [set.dots[i * 3], set.dots[i * 3 + 1], set.dots[i * 3 + 2]];
                at.push(...p);
                size.push(i === set.hotDot ? 15 : set.dotPicked[i] ? 11 : set.quiet ? 6 : 9);
                if (set.dotPicked[i]) rings.push(...p);
            }
            const was = this.controlDots[k];
            if (at.length === 0) { if (was) was.visible = false; return; }
            const pts = was ?? (this.controlDots[k] = this.handlePoints('dot'));
            pts.geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(at), 3));
            pts.geometry.setAttribute('aSize', new THREE.BufferAttribute(Float32Array.from(size), 1));
            pts.material.uniforms.uColor.value.set(set.colors[side]);
            pts.visible = true;
        });
        if (rings.length > 0) {
            const r = this.controlRings ?? (this.controlRings = this.handlePoints('ring'));
            r.geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(rings), 3));
            r.geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(rings.length / 3).fill(19), 1));
            r.material.uniforms.uColor.value.set('#ffc107');
            r.visible = true;
        } else if (this.controlRings) {
            this.controlRings.visible = false;
        }
        this.applyHandleClip();
        this.requestRender();
    }

    /**
     * A surface's logged contacts, to be moved along their holes or left out by hand (local xyz triples; `state` 0 as
     * logged, 1 moved, 2 left out; `hot` the one pointed at or dragged, drawn larger; null: none). Squares a size on
     * the screen, cut by the slices.
     */
    setContactHandles(set: { positions: Float32Array; state: Uint8Array; hot: number } | null) {
        const looks: { kind: 'square' | 'box'; color: string }[] = [{ kind: 'square', color: '#546e7a' }, { kind: 'square', color: '#1e88e5' }, { kind: 'box', color: '#e53935' }];
        looks.forEach((look, k) => {
            const at: number[] = [], size: number[] = [];
            const n = set ? Math.floor(set.positions.length / 3) : 0;
            for (let i = 0; i < n; i++) {
                if (set!.state[i] !== k) continue;
                at.push(set!.positions[i * 3], set!.positions[i * 3 + 1], set!.positions[i * 3 + 2]);
                size.push(i === set!.hot ? 14 : 8);
            }
            const was = this.contactHandles[k];
            if (at.length === 0) { if (was) was.visible = false; return; }
            const pts = was ?? (this.contactHandles[k] = this.handlePoints(look.kind));
            pts.geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(at), 3));
            pts.geometry.setAttribute('aSize', new THREE.BufferAttribute(Float32Array.from(size), 1));
            pts.material.uniforms.uColor.value.set(look.color);
            pts.visible = true;
        });
        this.applyHandleClip();
        this.requestRender();
    }

    /** Open squares at places a node can snap to: where lines of other sections cross the slice (local xyz triples; null or empty: none). */
    setTargetMarks(positions: Float32Array | null, color = '#7e57c2') {
        if (!positions || positions.length < 3) {
            if (this.targetMarks) this.targetMarks.visible = false;
            this.requestRender();
            return;
        }
        const m = this.targetMarks ?? (this.targetMarks = this.handlePoints('box'));
        m.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        m.geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(positions.length / 3).fill(13), 1));
        m.material.uniforms.uColor.value.set(color);
        m.visible = true;
        this.applyHandleClip();
        this.requestRender();
    }

    /** A ring where the next point would be placed (local xyz; null: none). */
    setSnapMarker(position: ArrayLike<number> | null, color = '#000000') {
        if (!position) {
            if (this.snapMarker) this.snapMarker.visible = false;
            this.requestRender();
            return;
        }
        const m = this.snapMarker ?? (this.snapMarker = this.handlePoints('ring'));
        m.geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from([position[0], position[1], position[2]]), 3));
        m.geometry.setAttribute('aSize', new THREE.BufferAttribute(Float32Array.from([18]), 1));
        m.material.uniforms.uColor.value.set(color);
        m.visible = true;
        this.requestRender();
    }

    // --- satellite image ----------------------------------------------------------

    private clearGround() {
        for (const child of [...this.groundGroup.children]) {
            this.groundGroup.remove(child);
            const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
            mesh.geometry.dispose();
            mesh.material.map?.dispose();
            mesh.material.dispose();
        }
    }

    /** Horizontal image made of map tiles (null removes it). Each tile appears when its picture arrives. */
    setGround(tiles: GroundTile[] | null) {
        this.clearGround();
        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin('anonymous'); // keeps the canvas exportable (Save PNG, reports)
        const anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        for (const tile of tiles ?? []) {
            const n = tile.segments + 1;
            const position = new Float32Array(n * n * 3);
            const uv = new Float32Array(n * n * 2);
            for (let j = 0, v = 0; j < n; j++) {
                for (let i = 0; i < n; i++, v++) {
                    position[v * 3] = tile.xy[v * 2];
                    position[v * 3 + 1] = tile.xy[v * 2 + 1];
                    uv[v * 2] = i / tile.segments;
                    uv[v * 2 + 1] = 1 - j / tile.segments; // row 0 = north = top of the picture
                }
            }
            const index: number[] = [];
            for (let j = 0; j < tile.segments; j++) {
                for (let i = 0; i < tile.segments; i++) {
                    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
                    index.push(a, c, b, b, c, d);
                }
            }
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(position, 3));
            geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
            geom.setIndex(index);
            const material = new THREE.MeshBasicMaterial({
                side: THREE.DoubleSide,
                // Coincident samples (flat data, surface samples) draw on top of the image
                polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
            });
            const mesh = new THREE.Mesh(geom, material);
            mesh.visible = false;
            mesh.renderOrder = -1;
            material.map = loader.load(tile.url, texture => {
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.anisotropy = anisotropy;
                texture.needsUpdate = true;
                mesh.visible = true;
                this.requestRender();
            });
            this.groundGroup.add(mesh);
        }
        this.setGroundStyle(this.groundZ, this.groundOpacity);
    }

    /** `z` is the image's level in local coordinates (vertical exaggeration not applied). */
    setGroundStyle(z: number, opacity: number) {
        this.groundZ = z;
        this.groundOpacity = opacity;
        this.groundGroup.position.z = z * this.vex;
        for (const child of this.groundGroup.children) {
            const material = (child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material;
            material.opacity = opacity;
            material.transparent = opacity < 1;
            // See-through image: samples behind it stay visible
            material.depthWrite = opacity >= 1;
            material.needsUpdate = true;
        }
        this.requestRender();
    }

    // --- wireframes ---------------------------------------------------------------

    /**
     * Show these wireframes and surfaces (world coordinates), re-origined like the points.
     * Geometry is rebuilt only when a layer's mesh or the origin changes;
     * colour / opacity / edges / visibility changes just restyle.
     */
    setWireframes(layers: readonly MeshLayer[], origin: [number, number, number]) {
        const key = origin.join(',');
        const keep = new Set<string>();
        for (const layer of layers) {
            keep.add(layer.id);
            let w = this.wires.get(layer.id);
            if (w && (w.part !== layer.part || w.originKey !== key)) {
                this.disposeWire(w);
                this.wires.delete(layer.id);
                w = undefined;
            }
            if (!w) {
                w = buildWire(layer.part, origin, key);
                this.wires.set(layer.id, w);
                this.wireGroup.add(w.group);
            }
            styleWire(w, layer);
        }
        for (const [id, w] of this.wires) {
            if (keep.has(id)) continue;
            this.disposeWire(w);
            this.wires.delete(id);
        }
        const visible = layers.filter(l => l.visible);
        this.wireBounds = visible.length > 0 ? {
            min: [0, 1, 2].map(k => Math.min(...visible.map(l => l.part.bounds.min[k])) - origin[k]),
            max: [0, 1, 2].map(k => Math.max(...visible.map(l => l.part.bounds.max[k])) - origin[k]),
        } : null;
        this.applyWireClip();
        this.updateDepthRange(); // the near/far planes cover the wireframes too
        this.requestRender();
    }

    private applyWireClip() {
        const cut = this.clip ? clipPlanes(this.clip, this.vex) : [];
        const slabs = this.clip?.slabs ?? [];
        // (A mesh the slices leave whole is still cut by the clip box)
        const boxOnly = this.clip && slabs.length > 0 ? clipPlanes({ ...this.clip, slabs: [] }, this.vex) : cut;
        for (const w of this.wires.values()) {
            const planes = w.whole ? boxOnly : cut;
            for (const m of [w.meshMaterial, w.lineMaterial, w.edgeMaterial, w.outlineMaterial, w.creaseMaterial]) {
                if ((m.clippingPlanes?.length ?? 0) !== planes.length) m.needsUpdate = true;
                m.clippingPlanes = planes;
            }
            this.applyWireCuts(w, slabs);
        }
        // Sections that lie on one plane (a dyke in its host): the smaller is drawn in front of the larger
        const fills = [...this.wires.values()].flatMap(w => w.cuts).filter(c => c.fill && c.area !== null).sort((a, b) => a.area! - b.area!);
        fills.forEach((c, rank) => { c.fillMaterial.polygonOffsetFactor = 1 + rank; c.fillMaterial.polygonOffsetUnits = 1 + rank; });
    }

    /**
     * A mesh drawn on a slice as its line there, or its section filled: while a slice is on, its cut by each
     * slice's own plane is drawn in place of the mesh. The cut is worked out again only when the plane moves.
     */
    private applyWireCuts(w: WireObject, slabs: readonly ClipSlab[]) {
        const kind = w.onSlice && w.mesh && slabs.length > 0 ? w.onSlice : null;
        if (w.mesh) w.mesh.visible = w.show.mesh && !kind;
        if (w.edges) w.edges.visible = w.show.edges && !kind;
        if (w.creases) w.creases.visible = w.show.creases && !kind;
        if (w.outline) w.outline.visible = w.show.outline && !kind;
        const n = kind ? slabs.length : 0;
        while (w.cuts.length > n) disposeCut(w, w.cuts.pop()!);
        if (!kind || !this.clip) return;
        for (let i = 0; i < n; i++) {
            const s = slabs[i];
            const d = s.normal[0] * s.center[0] + s.normal[1] * s.center[1] + s.normal[2] * s.center[2];
            const key = `${kind}|${s.normal.join(',')}|${d}`;
            let c = w.cuts[i];
            if (!c || c.key !== key) {
                if (c) disposeCut(w, c);
                c = w.cuts[i] = buildCut(w, key, s.normal, d, kind === 'filled');
            }
            // Cut by the box and by the other slices; not by its own, whose plane it lies on
            const planes = clipPlanes({ ...this.clip, slabs: slabs.filter((_, j) => j !== i) }, this.vex);
            for (const m of [c.lineMaterial, c.fillMaterial]) {
                if ((m.clippingPlanes?.length ?? 0) !== planes.length) m.needsUpdate = true;
                m.clippingPlanes = planes;
            }
            const color = new THREE.Color(w.look.color);
            c.fillMaterial.color.copy(color);
            const translucent = w.look.fill < 0.999;
            if (c.fillMaterial.transparent !== translucent) { c.fillMaterial.transparent = translucent; c.fillMaterial.needsUpdate = true; }
            c.fillMaterial.opacity = w.look.fill;
            c.fillMaterial.depthWrite = !translucent;
            // The line: the pick colour while picked; round a fill, darker than it, so that sections side by side are told apart
            if (w.look.picked) c.lineMaterial.color.set(PICKED_COLOR); else c.lineMaterial.color.copy(color).multiplyScalar(c.fill ? 0.45 : 1);
        }
    }

    /** What a mesh's section on each slice that is on measures, where it is drawn filled (for tests and probes) */
    sectionAreas(id: string): (number | null)[] {
        return this.wires.get(id)?.cuts.map(c => c.area) ?? [];
    }

    private disposeWire(w: WireObject) {
        this.wireGroup.remove(w.group);
        w.mesh?.geometry.dispose();
        w.lines?.geometry.dispose();
        w.edges?.geometry.dispose();
        w.outline?.geometry.dispose();
        w.creases?.geometry.dispose();
        for (const c of w.cuts.splice(0)) disposeCut(w, c);
        w.creaseMaterial.dispose();
        w.meshMaterial.dispose();
        w.lineMaterial.dispose();
        w.edgeMaterial.dispose();
        w.outlineMaterial.dispose();
    }

    /** Point bounds grown to include the visible wireframes (local coords). */
    private sceneBounds(points: { min: number[]; max: number[] }) {
        const w = this.wireBounds;
        if (!w) return points;
        return {
            min: points.min.map((v, k) => Math.min(v, w.min[k])),
            max: points.max.map((v, k) => Math.max(v, w.max[k])),
        };
    }

    /** Bounding box outline + tick labels in world coordinates. */
    setAxes(labels: [string, string, string], color: string) {
        for (const child of [...this.axesGroup.children]) {
            this.axesGroup.remove(child);
            if (child instanceof THREE.LineSegments) child.geometry.dispose();
        }
        const g = this.geometry;
        if (!g || g.validCount === 0) return;
        const { min, max } = g.bounds;
        const vex = this.vex;
        const z0 = min[2] * vex, z1 = max[2] * vex;
        const pts = [
            [min[0], min[1], z0], [max[0], min[1], z0], [max[0], min[1], z0], [max[0], max[1], z0],
            [max[0], max[1], z0], [min[0], max[1], z0], [min[0], max[1], z0], [min[0], min[1], z0],
            [min[0], min[1], z0], [min[0], min[1], z1],
        ].map(p => new THREE.Vector3(...(p as [number, number, number])));
        const lines = new THREE.LineSegments(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 }),
        );
        this.axesGroup.add(lines);

        const o = g.origin;
        const size = Math.max(max[0] - min[0], max[1] - min[1], (max[2] - min[2]) * vex, 1);
        const off = size * 0.03;
        const label = (text: string, pos: [number, number, number], bold = false) => {
            const el = document.createElement('div');
            el.textContent = text;
            Object.assign(el.style, {
                color, font: `${bold ? 600 : 400} 11px Inter, system-ui, sans-serif`, whiteSpace: 'nowrap',
                textShadow: '0 0 3px rgba(0,0,0,0.15)',
            });
            const obj = new CSS2DObject(el);
            obj.position.set(...pos);
            this.axesGroup.add(obj);
        };
        for (const v of niceTicks(min[0] + o[0], max[0] + o[0], 4)) label(formatTick(v), [v - o[0], min[1] - off, z0]);
        for (const v of niceTicks(min[1] + o[1], max[1] + o[1], 4)) label(formatTick(v), [min[0] - off, v - o[1], z0]);
        if (max[2] > min[2]) {
            for (const v of niceTicks(min[2] + o[2], max[2] + o[2], 4)) label(formatTick(v), [min[0] - off, min[1] - off, (v - o[2]) * vex]);
        }
        label(labels[0], [(min[0] + max[0]) / 2, min[1] - off * 3, z0], true);
        label(labels[1], [min[0] - off * 3, (min[1] + max[1]) / 2, z0], true);
        if (labels[2]) label(labels[2], [min[0] - off * 3, min[1] - off * 3, (z0 + z1) / 2], true);
        label('N ↑', [max[0] + off, max[1] + off, z0], true);
        this.requestRender();
    }

    // --- camera -------------------------------------------------------------------

    setOrthographic(ortho: boolean) {
        const next = ortho ? this.orthographic : this.perspective;
        if (next === this.camera) return;
        next.position.copy(this.camera.position);
        next.up.set(0, 0, 1);
        if (ortho) {
            // Same apparent scale as the perspective view at the target distance
            const dist = this.camera.position.distanceTo(this.controls.target);
            const { height } = this.size();
            this.orthographic.zoom = height / (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2)));
        }
        next.updateProjectionMatrix();
        this.camera = next;
        this.controls.object = next;
        this.controls.update();
        this.updateDepthRange();
        this.requestRender();
    }

    /**
     * Frame `bounds` (local coordinates) without turning the view: the camera
     * keeps the direction it is looking in and moves to look at the box.
     */
    zoomTo(bounds: { min: ArrayLike<number>; max: ArrayLike<number> }) {
        const b = bounds, vex = this.vex;
        const center = new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, ((b.min[2] + b.max[2]) / 2) * vex);
        // Room around it (a hole's name sits above its top); a single sample is not zoomed into the ground
        const all = this.geometry?.bounds;
        const sceneSize = all ? Math.hypot(all.max[0] - all.min[0], all.max[1] - all.min[1], (all.max[2] - all.min[2]) * vex) : 0;
        const r = Math.max(0.7 * Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], (b.max[2] - b.min[2]) * vex), 0.01 * sceneSize, 1);
        const dir = this.camera.position.clone().sub(this.controls.target);
        if (dir.lengthSq() < 1e-12) dir.set(-0.6, -0.6, 0.53);
        dir.normalize();
        this.controls.target.copy(center);
        this.camera.position.copy(center).addScaledVector(dir, r * 2.6);
        const { width, height } = this.size();
        this.orthographic.zoom = Math.min(width, height) / (2.2 * r);
        this.orthographic.updateProjectionMatrix();
        this.controls.update();
        this.updateDepthRange();
        this.requestRender();
        this.onCameraChangeEnd?.();
    }

    getCameraState(): CameraState {
        const p = this.camera.position, t = this.controls.target;
        return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z], zoom: this.camera.zoom, ortho: this.camera === this.orthographic };
    }

    setCameraState(s: CameraState) {
        this.camera.position.set(...s.position);
        this.controls.target.set(...s.target);
        if (this.camera === this.orthographic) {
            const dist = this.camera.position.distanceTo(this.controls.target);
            const { height } = this.size();
            this.orthographic.zoom = s.ortho
                ? s.zoom
                : height / (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2)));
        }
        this.camera.updateProjectionMatrix();
        this.controls.update();
        this.updateDepthRange();
        this.requestRender();
    }

    /** Frame the data (or `bounds`, local coords) from a preset direction. */
    fitView(preset: ViewPreset, bounds?: { min: number[]; max: number[] }) {
        const g = this.geometry;
        if (!g) return;
        const b = bounds ?? this.sceneBounds(g.bounds);
        const vex = this.vex;
        const center = new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, ((b.min[2] + b.max[2]) / 2) * vex);
        const r = Math.max(0.5 * Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], (b.max[2] - b.min[2]) * vex), 1);
        const dirs: Record<ViewPreset, [number, number, number]> = {
            plan: [0, -0.0001, 1], north: [0, -1, 0], south: [0, 1, 0], east: [-1, 0, 0], west: [1, 0, 0],
            iso: [-0.6, -0.6, 0.53],
        };
        const dir = new THREE.Vector3(...dirs[preset]).normalize();
        this.camera.position.copy(center).addScaledVector(dir, r * 2.6);
        this.updateDepthRange();
        const { width, height } = this.size();
        this.orthographic.zoom = Math.min(width, height) / (2.2 * r);
        this.orthographic.updateProjectionMatrix();
        this.controls.target.copy(center);
        this.controls.update();
        this.requestRender();
    }

    // --- slices: placing them from the view, and looking at them ------------------------

    /**
     * The view ray through a CSS-pixel position, in drawing space (z multiplied
     * by the vertical exaggeration). Perspective rays leave the eye; orthographic
     * rays all run along the view direction.
     */
    screenRay(x: number, y: number): { origin: [number, number, number]; dir: [number, number, number] } {
        const cam = this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
        cam.updateMatrixWorld();
        const { width, height } = this.size();
        const ndc = new THREE.Vector3((x / width) * 2 - 1, 1 - (y / height) * 2, 0);
        if (cam === this.perspective) {
            const dir = ndc.setZ(0.5).unproject(cam).sub(cam.position).normalize();
            return { origin: cam.position.toArray(), dir: dir.toArray() };
        }
        const origin = ndc.setZ(-1).unproject(cam);
        return { origin: origin.toArray(), dir: cam.getWorldDirection(new THREE.Vector3()).toArray() };
    }

    /** Direction the camera looks, in drawing space. */
    viewDirection(): [number, number, number] {
        return this.camera.getWorldDirection(new THREE.Vector3()).toArray();
    }

    /**
     * Middle of what is on screen: the point on the view axis at the median
     * depth of the visible samples (local coordinates, exaggeration removed).
     * Falls back to the orbit target when nothing is in view.
     */
    viewFocus(): [number, number, number] {
        const cam = this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
        cam.updateMatrixWorld();
        const p = this.controls.target.clone();
        const g = this.geometry;
        if (g && g.validCount > 0) {
            const mvp = new THREE.Matrix4()
                .multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
                .multiply(new THREE.Matrix4().makeScale(1, 1, this.vex));
            const forward = cam.getWorldDirection(new THREE.Vector3());
            const { width, height } = this.size();
            const focus = findViewFocus(
                g.positions, mvp.elements, cam.position.toArray(), forward.toArray(), this.vex,
                width, height, null, this.isShown,
            );
            if (focus) p.copy(cam.position).addScaledVector(forward, focus.depth);
        }
        return [p.x, p.y, p.z / this.vex];
    }

    /**
     * A point or direction (drawing space) as the camera sees it: x right, y up,
     * z towards the viewer. Something fixed in these coordinates stays where it
     * is on screen as the camera moves.
     */
    toCameraSpace(v: ArrayLike<number>, direction: boolean): [number, number, number] {
        this.camera.updateMatrixWorld();
        const p = new THREE.Vector3(v[0], v[1], v[2]);
        return (direction ? p.transformDirection(this.camera.matrixWorldInverse) : p.applyMatrix4(this.camera.matrixWorldInverse)).toArray();
    }

    fromCameraSpace(v: ArrayLike<number>, direction: boolean): [number, number, number] {
        this.camera.updateMatrixWorld();
        const p = new THREE.Vector3(v[0], v[1], v[2]);
        return (direction ? p.transformDirection(this.camera.matrixWorld) : p.applyMatrix4(this.camera.matrixWorld)).toArray();
    }

    /** CSS-pixel position of a point (local coordinates) on screen. */
    projectPoint(p: ArrayLike<number>): [number, number] {
        const cam = this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
        cam.updateMatrixWorld();
        const { width, height } = this.size();
        const v = new THREE.Vector3(p[0], p[1], p[2] * this.vex).project(cam);
        return [(v.x + 1) * 0.5 * width, (1 - v.y) * 0.5 * height];
    }

    /** Screen pixels per metre at a point (local coordinates), across the view. */
    pixelsPerMetre(p: ArrayLike<number>): number {
        const cam = this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
        cam.updateMatrixWorld();
        const { height } = this.size();
        if (cam === this.orthographic) return (height * cam.zoom) / Math.max(cam.top - cam.bottom, 1e-9);
        const at = new THREE.Vector3(p[0], p[1], p[2] * this.vex).sub(cam.position);
        let depth = at.dot(cam.getWorldDirection(new THREE.Vector3()));
        if (!(depth > 1e-6)) depth = Math.max(cam.position.distanceTo(this.controls.target), 1e-6);
        return height / (2 * depth * Math.tan((this.perspective.fov * Math.PI) / 360));
    }

    /**
     * Turn the camera square-on to a plane and frame `outline`: the corners of
     * the part of the plane to look at (xyz triples, local coordinates).
     * `toViewer` is the plane's normal on the side to look from (local
     * coordinates, unit length).
     */
    lookAlong(toViewer: [number, number, number], outline: number[]) {
        const count = Math.floor(outline.length / 3);
        if (count === 0) return;
        const vex = this.vex;
        // The plane's normal in drawing space
        const dir = new THREE.Vector3(toViewer[0], toViewer[1], toViewer[2] / vex).normalize();
        const center = new THREE.Vector3();
        for (let i = 0; i < count; i++) center.add(new THREE.Vector3(outline[i * 3], outline[i * 3 + 1], outline[i * 3 + 2] * vex));
        center.divideScalar(count);
        let r = 1e-3;
        for (let i = 0; i < count; i++) {
            r = Math.max(r, center.distanceTo(new THREE.Vector3(outline[i * 3], outline[i * 3 + 1], outline[i * 3 + 2] * vex)));
        }
        const target = this.controls.target;
        // Straight up or down has no "up" for the orbit controls: tip it a hair, north to the top
        if (Math.abs(dir.z) > 0.99999) dir.set(0, -0.0001, Math.sign(dir.z)).normalize();
        target.copy(center);
        this.camera.position.copy(center).addScaledVector(dir, r * 2.6);
        const { width, height } = this.size();
        this.orthographic.zoom = Math.min(width, height) / (2.2 * r);
        this.orthographic.updateProjectionMatrix();
        this.controls.update();
        this.updateDepthRange();
        this.requestRender();
        this.onCameraChangeEnd?.();
    }

    /**
     * Turn the camera to look along `dir` (true space, x east, y north, z up:
     * the vertical exaggeration is applied here), keeping what it is looking
     * at and how far away it is.
     */
    lookDown(dir: ArrayLike<number>) {
        const d = new THREE.Vector3(dir[0], dir[1], dir[2] * this.vex);
        if (d.lengthSq() < 1e-18) return;
        d.normalize();
        // Straight up or down has no "up" for the orbit controls: tip it a hair, north to the top
        if (Math.abs(d.z) > 0.99999) d.set(0, 0.0001, Math.sign(d.z)).normalize();
        const target = this.controls.target;
        const dist = Math.max(this.camera.position.distanceTo(target), 1e-6);
        this.camera.position.copy(target).addScaledVector(d, -dist);
        this.controls.update();
        this.updateDepthRange();
        this.requestRender();
        this.onCameraChangeEnd?.();
    }

    /** Hear of every camera move (as onCameraChange does, for more than one listener). Returns the way to stop. */
    addCameraListener(heard: () => void): () => void {
        this.cameraListeners.add(heard);
        return () => { this.cameraListeners.delete(heard); };
    }

    // --- selection support -------------------------------------------------------------

    /** CSS-pixel screen positions of all points (NaN when off screen). */
    screenPositions(): Float32Array | null {
        if (!this.geometry) return null;
        const { width, height } = this.size();
        return projectToScreen(this.geometry.positions, this.mvp().elements, width, height);
    }

    /** CSS-pixel screen positions of any points (local xyz triples; NaN when off screen). */
    projectPoints(positions: Float32Array): Float32Array {
        const { width, height } = this.size();
        return projectToScreen(positions, this.mvp().elements, width, height);
    }

    /**
     * The matrix that takes local coordinates to the screen (column-major, the
     * vertical exaggeration included) and the view's size in CSS pixels: what
     * the pure picking functions (picking.ts, intervals.ts) work with.
     */
    screenMatrix(): { mvp: number[]; width: number; height: number; perspective: boolean } {
        return { mvp: this.mvp().elements.slice(), ...this.size(), perspective: this.camera === this.perspective };
    }

    screenshot(): string {
        this.renderNow();
        return this.renderer.domElement.toDataURL('image/png');
    }

    dispose() {
        this.setSliceFrames([]);
        this.setPlaneGrid(null);
        this.setHoleMarkers([]);
        for (const id of [...this.layers.keys()]) this.setLayer(id, null);
        cancelAnimationFrame(this.frame);
        this.resizeObserver.disconnect();
        this.controls.dispose();
        this.clearGround();
        this.pointGeom.dispose();
        this.pointMaterial.dispose();
        this.cylinders?.geometry.dispose();
        this.cylinderMaterial.dispose();
        this.logMark = null;
        this.setLogging([]);
        this.traceLines?.geometry.dispose();
        this.traceMaterial.dispose();
        for (const w of this.wires.values()) this.disposeWire(w);
        this.wires.clear();
        for (const h of [this.handles, this.nodes, this.snapMarker, this.selectedMarks, this.targetMarks, ...this.editLines]) {
            h?.geometry.dispose();
            h?.material.dispose();
        }
        const canvas = this.renderer.domElement;
        canvas.removeEventListener('pointerdown', this.handlePointerDown, { capture: true });
        canvas.removeEventListener('pointerup', this.handlePointerUp);
        canvas.removeEventListener('pointercancel', this.handlePointerUp);
        canvas.removeEventListener('wheel', this.handleWheel, { capture: true });
        canvas.removeEventListener('webglcontextlost', this.handleContextLost);
        canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
        this.renderer.dispose();
        // Free the context now, not at garbage collection (browsers allow ~16)
        this.renderer.forceContextLoss();
        canvas.remove();
        this.labelRenderer.domElement.remove();
    }
}

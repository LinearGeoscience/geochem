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
import { POINT_VERTEX_SHADER, POINT_FRAGMENT_SHADER } from './pointShaders';
import { PointCloudGeometry, ClipState, niceTicks, projectToScreen } from './geometry';
import type { ViewerStyleBuffers, DrillholeSegments } from './useViewerData';

export type ViewPreset = 'plan' | 'north' | 'south' | 'east' | 'west' | 'iso' | 'section';

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
    if (clip.slabEnabled) {
        // Local plane n·(p - c) = ±h with p.z = z'/vex  ->  world normal (nx, ny, nz/vex)
        const [nx, ny, nz] = clip.slabNormal;
        const w = new THREE.Vector3(nx, ny, nz / vex);
        const len = w.length();
        const nc = nx * clip.slabCenter[0] + ny * clip.slabCenter[1] + nz * clip.slabCenter[2];
        const n = w.clone().divideScalar(len);
        planes.push(
            new THREE.Plane(n.clone(), (-nc + clip.slabHalfWidth) / len),
            new THREE.Plane(n.clone().negate(), (nc + clip.slabHalfWidth) / len),
        );
    }
    return planes;
}

function formatTick(v: number): string {
    const a = Math.abs(v);
    if (a >= 1e5) return Math.round(v).toLocaleString();
    if (a >= 100) return v.toFixed(0);
    return String(Number(v.toPrecision(4)));
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
    private vex = 1;
    private clip: ClipState | null = null;
    private background = '#ffffff';

    /** Called after the user finishes a camera interaction (to persist the view). */
    onCameraChangeEnd: (() => void) | null = null;
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

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = false;
        this.controls.zoomToCursor = true;
        this.controls.addEventListener('change', () => this.requestRender());
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
                uSlabHalf: { value: 1 },
                uIsolate: { value: 0 },
                uHasSelection: { value: 0 },
                uSelectionColor: { value: new THREE.Color('#ff3d00') },
            },
        });
        this.points = new THREE.Points(this.pointGeom, this.pointMaterial);
        this.points.frustumCulled = false;
        this.scene.add(this.points, this.traceGroup, this.axesGroup);

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

    private size() {
        return { width: Math.max(this.container.clientWidth, 1), height: Math.max(this.container.clientHeight, 1) };
    }

    private resize() {
        const { width, height } = this.size();
        this.renderer.setSize(width, height);
        this.labelRenderer.setSize(width, height);
        this.perspective.aspect = width / height;
        this.perspective.updateProjectionMatrix();
        Object.assign(this.orthographic, { left: -width / 2, right: width / 2, top: height / 2, bottom: -height / 2 });
        this.orthographic.updateProjectionMatrix();
        this.requestRender();
    }

    requestRender() {
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.renderer.render(this.scene, this.camera);
            this.labelRenderer.render(this.scene, this.camera);
        });
    }

    setBackground(color: string) {
        this.background = color;
        this.renderer.setClearColor(new THREE.Color(color), 1);
        this.requestRender();
    }

    setInteractive(enabled: boolean) {
        this.controls.enabled = enabled;
    }

    // --- data ------------------------------------------------------------------

    setGeometry(geometry: PointCloudGeometry) {
        this.geometry = geometry;
        this.pointGeom.setAttribute('position', new THREE.BufferAttribute(geometry.positions, 3));
        this.requestRender();
    }

    setStyles(styles: ViewerStyleBuffers) {
        this.pointGeom.setAttribute('color', new THREE.BufferAttribute(styles.color, 4));
        this.pointGeom.setAttribute('size', new THREE.BufferAttribute(styles.size, 1));
        this.pointGeom.setAttribute('shape', new THREE.BufferAttribute(styles.shape, 1));
        this.traceLines?.geometry.setAttribute('color', new THREE.BufferAttribute(styles.color, 4));
        this.requestRender();
    }

    setFlags(flags: Float32Array, hasSelection: boolean) {
        this.pointGeom.setAttribute('flags', new THREE.BufferAttribute(flags, 1));
        this.pointMaterial.uniforms.uHasSelection.value = hasSelection ? 1 : 0;
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
        this.traceGroup.scale.set(1, 1, opts.vex);
        if (this.clip) this.traceMaterial.clippingPlanes = clipPlanes(this.clip, this.vex);
        this.requestRender();
    }

    setClip(clip: ClipState) {
        this.clip = clip;
        const u = this.pointMaterial.uniforms;
        u.uBoxEnabled.value = clip.boxEnabled ? 1 : 0;
        u.uBoxMin.value.set(...clip.boxMin);
        u.uBoxMax.value.set(...clip.boxMax);
        u.uSlabEnabled.value = clip.slabEnabled ? 1 : 0;
        u.uSlabNormal.value.set(...clip.slabNormal);
        u.uSlabCenter.value.set(...clip.slabCenter);
        u.uSlabHalf.value = clip.slabHalfWidth;
        this.traceMaterial.clippingPlanes = clipPlanes(clip, this.vex);
        this.traceMaterial.needsUpdate = true;
        this.requestRender();
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
        this.requestRender();
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
        this.requestRender();
    }

    /** Frame the data (or `bounds`, local coords) from a preset direction. */
    fitView(preset: ViewPreset, bounds?: { min: number[]; max: number[] }) {
        const g = this.geometry;
        if (!g) return;
        const b = bounds ?? g.bounds;
        const vex = this.vex;
        const center = new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, ((b.min[2] + b.max[2]) / 2) * vex);
        const r = Math.max(0.5 * Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], (b.max[2] - b.min[2]) * vex), 1);
        const n = this.clip?.slabNormal ?? [1, 0, 0];
        const dirs: Record<ViewPreset, [number, number, number]> = {
            plan: [0, -0.0001, 1], north: [0, -1, 0], south: [0, 1, 0], east: [-1, 0, 0], west: [1, 0, 0],
            iso: [-0.6, -0.6, 0.53], section: [n[0], n[1], n[2] / vex],
        };
        const dir = new THREE.Vector3(...dirs[preset]).normalize();
        this.camera.position.copy(center).addScaledVector(dir, r * 2.6);
        this.perspective.near = r * 0.01;
        this.perspective.far = r * 100;
        this.perspective.updateProjectionMatrix();
        const { width, height } = this.size();
        this.orthographic.zoom = Math.min(width, height) / (2.2 * r);
        this.orthographic.updateProjectionMatrix();
        this.controls.target.copy(center);
        this.controls.update();
        this.requestRender();
    }

    // --- selection support -------------------------------------------------------------

    /** CSS-pixel screen positions of all points (NaN when off screen). */
    screenPositions(): Float32Array | null {
        if (!this.geometry) return null;
        this.camera.updateMatrixWorld();
        const cam = this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
        const mvp = new THREE.Matrix4()
            .multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
            .multiply(new THREE.Matrix4().makeScale(1, 1, this.vex));
        const { width, height } = this.size();
        return projectToScreen(this.geometry.positions, mvp.elements, width, height);
    }

    screenshot(): string {
        this.renderer.render(this.scene, this.camera);
        return this.renderer.domElement.toDataURL('image/png');
    }

    dispose() {
        cancelAnimationFrame(this.frame);
        this.resizeObserver.disconnect();
        this.controls.dispose();
        this.pointGeom.dispose();
        this.pointMaterial.dispose();
        this.traceLines?.geometry.dispose();
        this.traceMaterial.dispose();
        const canvas = this.renderer.domElement;
        canvas.removeEventListener('webglcontextlost', this.handleContextLost);
        canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
        this.renderer.dispose();
        // Free the context now, not at garbage collection (browsers allow ~16)
        this.renderer.forceContextLoss();
        canvas.remove();
        this.labelRenderer.domElement.remove();
    }
}

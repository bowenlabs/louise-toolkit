// Edge-network globe for the marketing hero — a faithful three.js port of the
// design mock's `edge-globe.js`. A Fibonacci-sphere field of gold nodes inside a
// faint blue wireframe shell, with orange "request" arcs that travel between
// edge locations, rotating slowly with a little pointer parallax. Decorative and
// aria-hidden, loaded as progressive enhancement (the hero reads fine without
// it), and static under prefers-reduced-motion.
//
// three.js lives in the *site* app, not the dep-free toolkit package.
import {
  BufferAttribute,
  BufferGeometry,
  Clock,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  QuadraticBezierCurve3,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";

export interface EdgeGlobeOptions {
  nodeColor?: string;
  arcColor?: string;
  wireColor?: string;
  wireOpacity?: number;
  nodeOpacity?: number;
  density?: number;
  arcCount?: number;
  speed?: number;
}

export function initEdgeGlobe(canvas: HTMLCanvasElement, opts: EdgeGlobeOptions = {}) {
  const nodeColor = new Color(opts.nodeColor ?? "#f3ae29");
  const arcColor = new Color(opts.arcColor ?? "#db6327");
  const wireColor = new Color(opts.wireColor ?? "#1481ef");
  const wireOpacity = opts.wireOpacity ?? 0.22;
  const nodeOpacity = opts.nodeOpacity ?? 0.9;
  const density = opts.density ?? 800;
  const arcCount = opts.arcCount ?? 32;
  const speed = opts.speed ?? 1;

  const reduce =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.z = 3.05;

  const group = new Group();
  group.rotation.z = 0.18;
  scene.add(group);

  // Fibonacci-sphere node field.
  const pts = new Float32Array(density * 3);
  for (let i = 0; i < density; i++) {
    const y = 1 - (i / (density - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = i * 2.399963229728653; // golden angle
    pts[i * 3] = Math.cos(th) * r;
    pts[i * 3 + 1] = y;
    pts[i * 3 + 2] = Math.sin(th) * r;
  }
  const pgeo = new BufferGeometry();
  pgeo.setAttribute("position", new BufferAttribute(pts, 3));
  const pmat = new PointsMaterial({
    color: nodeColor,
    size: 0.016,
    transparent: true,
    opacity: nodeOpacity,
    sizeAttenuation: true,
  });
  group.add(new Points(pgeo, pmat));

  // Wireframe shell.
  const wmesh = new Mesh(
    new SphereGeometry(0.992, 28, 28),
    new MeshBasicMaterial({ color: wireColor, wireframe: true, transparent: true, opacity: wireOpacity }),
  );
  group.add(wmesh);

  // Request arcs between edge locations.
  const randPoint = (): Vector3 => {
    const v = new Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    return v.lengthSq() < 1e-6 ? randPoint() : v.normalize();
  };
  interface Arc {
    curve: QuadraticBezierCurve3;
    mat: LineBasicMaterial;
    dot: Mesh;
    t: number;
    speed: number;
  }
  const arcs: Arc[] = [];
  let guard = 0;
  while (arcs.length < arcCount && guard++ < arcCount * 20) {
    const p1 = randPoint();
    const p2 = randPoint();
    const d = p1.distanceTo(p2);
    if (d < 0.6 || d > 1.7) continue;
    const mid = p1.clone().add(p2).normalize().multiplyScalar(1 + d * 0.42);
    const curve = new QuadraticBezierCurve3(p1, mid, p2);
    const ageo = new BufferGeometry().setFromPoints(curve.getPoints(48));
    const amat = new LineBasicMaterial({ color: arcColor, transparent: true, opacity: 0 });
    group.add(new Line(ageo, amat));
    const dot = new Mesh(
      new SphereGeometry(0.017, 6, 6),
      new MeshBasicMaterial({ color: arcColor, transparent: true }),
    );
    group.add(dot);
    arcs.push({ curve, mat: amat, dot, t: Math.random() * 1.6, speed: 0.14 + Math.random() * 0.22 });
  }

  let mouseY = 0;
  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    mouseY = ((e.clientY - r.top) / Math.max(1, r.height) - 0.5) * 2;
  };
  if (!reduce) window.addEventListener("pointermove", onMove, { passive: true });

  const clock = new Clock();
  let lastW = 0;
  let lastH = 0;
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h || (w === lastW && h === lastH)) return;
    lastW = w;
    lastH = h;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function renderFrame(dt: number) {
    group.rotation.y += dt * 0.14 * speed;
    group.rotation.x += (mouseY * 0.18 - group.rotation.x) * 0.03;
    for (const A of arcs) {
      A.t += dt * A.speed * speed;
      if (A.t > 1.6) A.t = 0;
      const t = Math.min(A.t, 1);
      const fade = Math.sin(Math.min(A.t / 1.6, 1) * Math.PI);
      A.mat.opacity = 0.38 * fade;
      A.dot.visible = A.t <= 1;
      if (A.dot.visible) {
        A.dot.position.copy(A.curve.getPoint(t));
        (A.dot.material as MeshBasicMaterial).opacity = fade;
      }
    }
    renderer.render(scene, camera);
  }

  let raf = 0;
  let disposed = false;
  function tick() {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    resize();
    renderFrame(Math.min(clock.getDelta(), 0.05));
  }

  if (reduce) {
    resize();
    renderFrame(0); // one static frame
  } else {
    tick();
  }

  return {
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      renderer.dispose();
    },
  };
}

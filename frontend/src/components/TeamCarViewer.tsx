import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const conceptModelUrl = `${import.meta.env.BASE_URL}models/qvist-2026-assemblies.glb`;

function loadModel(url: string, onProgress: (value: number) => void): Promise<GLTF> {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url, (event) => {
    if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
  });
}

function disposeModel(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}

type CameraTransition = { fromPosition: THREE.Vector3; toPosition: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; start: number; duration: number };

const views: Array<{ name: string; position: readonly [number, number, number] }> = [
  { name: 'Front', position: [-1, 0.25, 0] },
  { name: 'Side', position: [0, 0.25, 1] },
  { name: 'Rear', position: [1, 0.25, 0] },
  { name: 'Top', position: [0, 1, 0] },
];

interface TeamCarViewerProps {
  teamName: string;
  season: number;
  /** Omit to show the existing concept car; pass null when a team has no supplied model. */
  modelUrl?: string | null;
  modelNote?: string;
}

export default function TeamCarViewer({ teamName, season, modelUrl, modelNote }: TeamCarViewerProps) {
  const selectedModelUrl = modelUrl === undefined ? conceptModelUrl : modelUrl;
  const isFallback = selectedModelUrl === null;
  const mountRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const transitionRef = useRef<CameraTransition | null>(null);
  const [loading, setLoading] = useState(!isFallback);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let active = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b0e13');
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(-7, 3.2, 5.6);
    cameraRef.current = camera;
    sceneRef.current = scene;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute('aria-label', `Interactive 3D view of the ${season} ${teamName} car`);
    renderer.domElement.setAttribute('role', 'img');
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.1, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 4.7;
    controls.maxDistance = 12;
    controls.minPolarAngle = 0.12;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.autoRotate = spinning;
    controls.autoRotateSpeed = 0.7;
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xcbd9f2, 0x252932, 2.2));
    const keyLight = new THREE.DirectionalLight(0xfff0df, 3.4);
    keyLight.position.set(-4, 8, 7);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x83baff, 2.2);
    rimLight.position.set(5, 4, -7);
    scene.add(rimLight);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: '#11151b', roughness: 0.86, metalness: 0.1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.52;
    floor.receiveShadow = true;
    scene.add(floor);

    const resize = () => {
      if (!active) return;
      const { width, height } = mount.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    renderer.setAnimationLoop(() => {
      const transition = transitionRef.current;
      if (transition) {
        const amount = Math.min(1, (performance.now() - transition.start) / transition.duration);
        const eased = amount * amount * (3 - 2 * amount);
        camera.position.lerpVectors(transition.fromPosition, transition.toPosition, eased);
        controls.target.lerpVectors(transition.fromTarget, transition.toTarget, eased);
        if (amount === 1) transitionRef.current = null;
      }
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      active = false;
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      controlsRef.current = null;
      cameraRef.current = null;
      sceneRef.current = null;
      transitionRef.current = null;
      if (modelRef.current) disposeModel(modelRef.current);
      modelRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
      disposeModel(floor);
    };
  }, [season]);

  useEffect(() => {
    const scene = sceneRef.current;
    const url = selectedModelUrl;
    setError(false);
    setProgress(0);
    if (!url) {
      if (modelRef.current && scene) scene.remove(modelRef.current);
      if (modelRef.current) disposeModel(modelRef.current);
      modelRef.current = null;
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    void loadModel(url, (value) => { if (active) setProgress(value); }).then((gltf) => {
      if (!active) { disposeModel(gltf.scene); return; }
      const targetScene = sceneRef.current;
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!targetScene || !camera || !controls) { disposeModel(gltf.scene); return; }

      const car = gltf.scene;
      car.traverse((object) => {
        if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; }
      });
      const bounds = new THREE.Box3().setFromObject(car);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      const scale = 5.4 / Math.max(size.x, size.y, size.z);
      car.position.sub(center).multiplyScalar(scale);
      car.scale.setScalar(scale);
      if (modelRef.current) {
        targetScene.remove(modelRef.current);
        disposeModel(modelRef.current);
      }
      modelRef.current = car;
      targetScene.add(car);
      transitionRef.current = {
        fromPosition: camera.position.clone(),
        toPosition: new THREE.Vector3(-7, 3.2, 5.6),
        fromTarget: controls.target.clone(),
        toTarget: new THREE.Vector3(0, 0.12, 0),
        start: performance.now(),
        duration: 520,
      };
      setLoading(false);
    }).catch(() => {
      if (active) { setError(true); setLoading(false); }
    });
    return () => { active = false; };
  }, [selectedModelUrl, retry, season]);

  useEffect(() => {
    mountRef.current?.querySelector('canvas')?.setAttribute('aria-label', `Interactive 3D view of the ${season} ${teamName} car`);
  }, [season, teamName]);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = spinning;
  }, [spinning]);

  const setView = (direction: typeof views[number]['position']) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls || isFallback) return;
    const radius = 8.7;
    transitionRef.current = {
      fromPosition: camera.position.clone(),
      toPosition: new THREE.Vector3(direction[0] * radius, direction[1] * radius, direction[2] * radius),
      fromTarget: controls.target.clone(),
      toTarget: new THREE.Vector3(0, 0.12, 0),
      start: performance.now(),
      duration: 420,
    };
  };

  const note: ReactNode = modelNote ?? (isFallback ? 'No model was supplied for this constructor. Another team’s car is not shown as a substitute.' : <>Based on the <a href="https://sketchfab.com/3d-models/f1-2026-concept-polygon-model-ea3bde709b1e4dc9b0ec8557d106ed42" target="_blank" rel="noreferrer">F1 2026 concept (polygon model)</a> by <a href="https://sketchfab.com/Qvist_Designs" target="_blank" rel="noreferrer">Qvist_designs</a>, shared under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. Viewer asset changes: grouped into 16 display assemblies, assigned red and graphite study finishes, normalized for viewing, and meshopt-compressed with vertex quantization; all 1,217,296 triangles are retained. The same concept appears for every team; this is not an official team car or an exact 2026 race car. <a href={`${import.meta.env.BASE_URL}models/ATTRIBUTION.md`} target="_blank" rel="noreferrer">Full attribution and change notes</a>.</>);
  return <section className="car-viewer glass-card" aria-label={`${teamName} car viewer`}>
    <div className="car-viewer-heading">
      <div><div className="eyebrow">THE GARAGE · {season}</div><h2>Explore the car</h2></div>
      <span className="data-chip">{isFallback ? 'MODEL UNAVAILABLE' : 'INTERACTIVE 3D'}</span>
    </div>
    <div className="car-viewer-stage">
      <div className="car-viewer-canvas" ref={mountRef} />
      {isFallback && <div className="car-viewer-status car-viewer-no-model" role="status"><span aria-hidden="true">{teamName.slice(0, 1).toUpperCase()}</span><strong>No dedicated 3D model supplied</strong><small>{teamName} team information is still available below.</small></div>}
      {!isFallback && loading && <div className="car-viewer-status" role="status"><span className="car-viewer-spinner" /><strong>Loading 3D model</strong><span>{progress ? `${progress}%` : 'Preparing the garage'}</span></div>}
      {!isFallback && error && <div className="car-viewer-status car-viewer-status-error" role="alert"><strong>Could not load this local car model</strong><button className="button-secondary" onClick={() => { setError(false); setLoading(true); setProgress(0); setRetry((value) => value + 1); }}>Try again</button></div>}
      {!isFallback && <span className="car-viewer-hint">DRAG TO ORBIT · SCROLL TO ZOOM</span>}
    </div>
    {!isFallback && <div className="car-viewer-toolbar" aria-label="Car camera controls">
      {views.map((view) => <button key={view.name} className="button-secondary car-view-button" onClick={() => setView(view.position)}>{view.name}</button>)}
      <button className="button-secondary car-view-button" onClick={() => setSpinning((value) => !value)} aria-pressed={spinning}>{spinning ? 'Stop spin' : 'Auto spin'}</button>
      <button className="button-secondary car-view-button" onClick={() => setView([-1, 0.45, 0.65])}>Reset view</button>
    </div>}
    <p className="car-viewer-note">{note}</p>
  </section>;
}

/**
 * Three.js scene for the Satellite 3D page.
 *
 * Callers pass positions in Earth-centred inertial (ECI) coordinates, where +Z is the north pole.
 * Three.js is Y-up, so everything that lives in ECI space hangs off `eciGroup`, which rotates
 * ECI (x, y, z) to scene (x, z, -y). The Earth mesh then only needs to spin about scene +Y.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { EARTH_RADIUS_KM } from './sgp4';

export const KM_TO_UNITS = 0.001;
export const EARTH_RADIUS_UNITS = EARTH_RADIUS_KM * KM_TO_UNITS;
const MAX_SATELLITES = 5000;
const ISS_ID = 25544;
const ISS_BASE_SCALE = 2.4;
const CAMERA_NEAR = EARTH_RADIUS_UNITS * 0.0003;
const CAMERA_FAR = EARTH_RADIUS_UNITS * 160;
const DEFAULT_DISTANCE_Y = EARTH_RADIUS_UNITS * 2.1;
const DEFAULT_DISTANCE_Z = EARTH_RADIUS_UNITS * 3.3;

export interface SatelliteVisualState {
  id: number;
  position: [number, number, number];
  color: number;
  scale?: number;
  visible?: boolean;
  quaternion?: [number, number, number, number];
}

export interface TrailState {
  id: number;
  positions: Float32Array;
  count: number;
}

type OverlayLine = THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;

interface TrailRecord {
  geometry: THREE.BufferGeometry;
  line: OverlayLine;
}

export interface OrbitState {
  id: number;
  positions: Float32Array;
  color: number;
}

interface OrbitRecord {
  geometry: THREE.BufferGeometry;
  line: OverlayLine;
}

const TRAIL_COLOR = new THREE.Color(0x7bc0ff);

/** Rotates an ECI vector (Z-up) into the Y-up scene frame. */
function eciToScene(target: THREE.Vector3, x: number, y: number, z: number): THREE.Vector3 {
  return target.set(x, z, -y);
}

/**
 * Flat stand-in used until the remote Earth imagery arrives, and kept if it never does,
 * so the globe is never an unlit black disc.
 */
function placeholderTexture(fill: string, grid: string | null): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (grid) {
      ctx.strokeStyle = grid;
      ctx.lineWidth = 1;
      for (let lon = 0; lon <= 360; lon += 30) {
        const x = (lon / 360) * canvas.width;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let lat = 0; lat <= 180; lat += 30) {
        const y = (lat / 180) * canvas.height;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Swaps `uniform.value` for the remote image once it loads; failures keep the placeholder. */
function loadEarthTexture(url: string, uniform: { value: THREE.Texture }): void {
  new THREE.TextureLoader().load(
    url,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      uniform.value.dispose();
      uniform.value = texture;
    },
    undefined,
    () => {
      // Keep the placeholder; the scene stays usable without the imagery.
    },
  );
}

// Served from this site (public/textures): the day map and city lights from the three.js examples.
const DAY_TEXTURE = `${import.meta.env.BASE_URL}textures/earth-day.jpg`;
const NIGHT_TEXTURE = `${import.meta.env.BASE_URL}textures/earth-night.jpg`;

const ATMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    float intensity = pow(0.7 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 5.0);
    gl_FragColor = vec4(0.35, 0.65, 1.0, 1.0) * intensity;
  }
`;

const EARTH_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const EARTH_FRAGMENT = /* glsl */ `
  uniform sampler2D dayTex;
  uniform sampler2D nightTex;
  uniform vec3 sunDirection;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldNormal;
  void main() {
    vec3 day = texture2D(dayTex, vUv).rgb;
    vec3 night = texture2D(nightTex, vUv).rgb;
    float diffuse = dot(normalize(vWorldNormal), normalize(sunDirection));
    float mixAmount = smoothstep(-0.15, 0.3, diffuse);
    vec3 ambient = vec3(0.08, 0.11, 0.18);
    vec3 color = mix(night * 0.55 + ambient, day * 1.2 + ambient * 0.4, mixAmount);
    gl_FragColor = vec4(color, 1.0);
  }
`;

interface IssModel {
  group: THREE.Group;
  meshes: Array<THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>>;
  boundingRadius: number;
}

function createSatelliteGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(0.06, 0.06, 0.12);
  const nose = new THREE.ConeGeometry(0.028, 0.06, 14);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, 0, 0.09);
  const engine = new THREE.CylinderGeometry(0.012, 0.02, 0.06, 12);
  engine.rotateX(Math.PI / 2);
  engine.translate(0, 0, -0.08);
  const busStrut = new THREE.CylinderGeometry(0.01, 0.01, 0.24, 10);
  busStrut.rotateZ(Math.PI / 2);
  const rightPanel = new THREE.BoxGeometry(0.22, 0.012, 0.36);
  rightPanel.translate(0.19, 0, 0);
  const leftPanel = rightPanel.clone();
  leftPanel.translate(-0.38, 0, 0);
  const dish = new THREE.CylinderGeometry(0.0, 0.04, 0.08, 16, 1, true);
  dish.rotateX(Math.PI / 2);
  dish.translate(0, 0.05, 0.04);
  const boom = new THREE.CylinderGeometry(0.007, 0.007, 0.26, 8);
  boom.rotateX(Math.PI / 2);
  boom.translate(0, 0.04, -0.02);
  const radiator = new THREE.BoxGeometry(0.12, 0.02, 0.08);
  radiator.translate(0, 0.03, -0.06);
  const antenna = new THREE.CylinderGeometry(0.004, 0.004, 0.26, 10);
  antenna.rotateX(Math.PI / 2);
  antenna.translate(0.04, 0.05, 0.1);
  const antennaMirror = antenna.clone();
  antennaMirror.translate(-0.08, 0, 0);
  const merged = mergeGeometries(
    [
      body,
      nose,
      engine,
      busStrut,
      rightPanel,
      leftPanel,
      dish,
      boom,
      radiator,
      antenna,
      antennaMirror,
    ],
    false,
  );
  if (!merged) {
    throw new Error('Failed to build satellite geometry');
  }
  merged.computeVertexNormals();

  const positionAttribute = merged.getAttribute('position');
  if (!positionAttribute || positionAttribute.itemSize !== 3) {
    throw new Error('Satellite geometry missing positions');
  }
  const colors = new Float32Array(positionAttribute.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < positionAttribute.count; i += 1) {
    const x = positionAttribute.getX(i);
    const y = positionAttribute.getY(i);
    const z = positionAttribute.getZ(i);
    if (Math.abs(x) > 0.16 && Math.abs(z) < 0.28) {
      color.set(0x103b7c);
    } else if (z > 0.05) {
      color.set(0xffc989);
    } else if (y > 0.035 && z < -0.02) {
      color.set(0xf4f8ff);
    } else if (Math.abs(x) > 0.1 && Math.abs(z) > 0.25) {
      color.set(0x314568);
    } else {
      color.set(0xd9e3f7);
    }
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return merged;
}

function createIssModel(): IssModel {
  const group = new THREE.Group();
  group.visible = false;
  group.userData.id = ISS_ID;

  const meshes: Array<THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>> = [];

  const trussMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xcfd8f9,
    metalness: 0.55,
    roughness: 0.35,
    clearcoat: 0.35,
    clearcoatRoughness: 0.45,
  });
  const moduleMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xdfe8ff,
    metalness: 0.3,
    roughness: 0.38,
    clearcoat: 0.5,
    clearcoatRoughness: 0.25,
  });
  const radiatorMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xf6f8ff,
    metalness: 0.25,
    roughness: 0.5,
    emissive: new THREE.Color(0xdde9ff),
    emissiveIntensity: 0.25,
    clearcoat: 0.35,
    clearcoatRoughness: 0.2,
  });
  const panelMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x0f2f6b,
    emissive: new THREE.Color(0x0a214b),
    emissiveIntensity: 0.5,
    metalness: 0.2,
    roughness: 0.7,
    clearcoat: 0.15,
    clearcoatRoughness: 0.4,
  });
  const accentMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffd9a3,
    metalness: 0.4,
    roughness: 0.45,
    clearcoat: 0.2,
    clearcoatRoughness: 0.3,
  });

  const addMesh = (geometry: THREE.BufferGeometry, material: THREE.MeshPhysicalMaterial) => {
    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
    meshes.push(mesh);
    return mesh;
  };

  const mainTruss = new THREE.BoxGeometry(0.12, 0.05, 0.8);
  addMesh(mainTruss, trussMaterial);

  const trussExtensions = new THREE.BoxGeometry(0.06, 0.04, 1.1);
  const trussRight = addMesh(trussExtensions.clone(), trussMaterial);
  trussRight.position.x = 0.13;
  const trussLeft = addMesh(trussExtensions.clone(), trussMaterial);
  trussLeft.position.x = -0.13;

  const serviceModule = new THREE.CylinderGeometry(0.055, 0.055, 0.28, 24);
  serviceModule.rotateZ(Math.PI / 2);
  addMesh(serviceModule, moduleMaterial);

  const node1 = new THREE.CylinderGeometry(0.045, 0.045, 0.18, 24);
  node1.rotateZ(Math.PI / 2);
  const nodeMesh = addMesh(node1, moduleMaterial);
  nodeMesh.position.z = -0.15;

  const labModule = new THREE.CylinderGeometry(0.05, 0.05, 0.26, 26);
  labModule.rotateZ(Math.PI / 2);
  const labMesh = addMesh(labModule, moduleMaterial);
  labMesh.position.z = 0.18;

  const cupola = new THREE.CylinderGeometry(0.025, 0.04, 0.07, 12);
  const cupolaMesh = addMesh(cupola, accentMaterial);
  cupolaMesh.position.y = -0.05;
  cupolaMesh.position.z = -0.16;

  const radiator = new THREE.BoxGeometry(0.02, 0.42, 0.26);
  const radiatorRight = addMesh(radiator.clone(), radiatorMaterial);
  radiatorRight.position.set(0.32, 0, 0.32);
  radiatorRight.rotation.z = THREE.MathUtils.degToRad(8);
  const radiatorLeft = addMesh(radiator.clone(), radiatorMaterial);
  radiatorLeft.position.set(-0.32, 0, 0.32);
  radiatorLeft.rotation.z = THREE.MathUtils.degToRad(-8);

  const panel = new THREE.BoxGeometry(0.02, 0.6, 0.9);
  const panelRight = addMesh(panel.clone(), panelMaterial);
  panelRight.position.set(0.5, 0, 0);
  const panelLeft = addMesh(panel.clone(), panelMaterial);
  panelLeft.position.set(-0.5, 0, 0);

  const boomGeometry = new THREE.CylinderGeometry(0.015, 0.015, 0.38, 12);
  boomGeometry.rotateZ(Math.PI / 2);
  const boom = addMesh(boomGeometry, trussMaterial);
  boom.position.set(0, 0.05, 0.25);

  const adapter = new THREE.CylinderGeometry(0.025, 0.04, 0.1, 16);
  adapter.rotateZ(Math.PI / 2);
  const adapterMesh = addMesh(adapter, accentMaterial);
  adapterMesh.position.z = 0.35;

  const sensor = new THREE.SphereGeometry(0.03, 18, 18);
  const sensorMesh = addMesh(sensor, accentMaterial);
  sensorMesh.position.set(0, 0.07, -0.3);

  const panelStrut = new THREE.CylinderGeometry(0.008, 0.008, 0.78, 14);
  panelStrut.rotateZ(Math.PI / 2);
  const strutRight = addMesh(panelStrut.clone(), trussMaterial);
  strutRight.position.set(0.36, 0, 0.04);
  const strutLeft = addMesh(panelStrut.clone(), trussMaterial);
  strutLeft.position.set(-0.36, 0, 0.04);

  const dockingPort = new THREE.CylinderGeometry(0.02, 0.03, 0.16, 18);
  dockingPort.rotateZ(Math.PI / 2);
  const dockingMesh = addMesh(dockingPort, moduleMaterial);
  dockingMesh.position.z = -0.32;

  const navPodGeometry = new THREE.SphereGeometry(0.018, 16, 16);
  const navPodRight = addMesh(navPodGeometry.clone(), accentMaterial);
  navPodRight.position.set(0.16, 0.05, -0.24);
  const navPodLeft = addMesh(navPodGeometry.clone(), accentMaterial);
  navPodLeft.position.set(-0.16, 0.05, -0.24);

  const previousVisibility = group.visible;
  group.visible = true;
  group.updateMatrixWorld(true);
  const boundingSphere = new THREE.Sphere();
  new THREE.Box3().setFromObject(group).getBoundingSphere(boundingSphere);
  const boundingRadius = Number.isFinite(boundingSphere.radius) && boundingSphere.radius > 0 ? boundingSphere.radius : 0.9;
  group.visible = previousVisibility;

  return { group, meshes, boundingRadius };
}

export class EarthScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly raycaster: THREE.Raycaster;

  private resizeObserver: ResizeObserver | null = null;
  private readonly instancedMesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  private readonly instanceIds: Int32Array;
  private readonly dummyObject: THREE.Object3D;
  private readonly color: THREE.Color;
  private readonly dayNightUniforms: { sunDirection: { value: THREE.Vector3 } };
  private readonly earthGroup: THREE.Group;
  private readonly issModel: IssModel;
  private satelliteBoundingRadius = 0.3;
  private issBoundingRadius = 0.9;
  private readonly clearancePadding: number;
  private readonly trailMap = new Map<number, TrailRecord>();
  private readonly orbitMap = new Map<number, OrbitRecord>();
  private readonly eciGroup: THREE.Group;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly pointer = new THREE.Vector2();
  private readonly focusTarget = new THREE.Vector3();
  private readonly focusOffset = new THREE.Vector3();

  constructor(private readonly container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020b1e);
    this.scene.fog = new THREE.FogExp2(0x020c1e, 0.018);

    this.camera = new THREE.PerspectiveCamera(45, 1, CAMERA_NEAR, CAMERA_FAR);
    this.camera.position.set(0, DEFAULT_DISTANCE_Y, DEFAULT_DISTANCE_Z);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.shadowMap.enabled = false;
    this.renderer.autoClear = true;
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.pointerEvents = 'auto';

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = EARTH_RADIUS_UNITS * 1.05;
    this.controls.maxDistance = EARTH_RADIUS_UNITS * 90;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this.raycaster = new THREE.Raycaster();

    this.dummyObject = new THREE.Object3D();
    this.color = new THREE.Color();

    this.dayNightUniforms = { sunDirection: { value: new THREE.Vector3(1, 0, 0) } };
    this.clearancePadding = EARTH_RADIUS_UNITS * 0.015;

    const dayTex = { value: placeholderTexture('#1d4f86', 'rgba(170, 215, 255, 0.35)') as THREE.Texture };
    const nightTex = { value: placeholderTexture('#030812', null) as THREE.Texture };
    loadEarthTexture(DAY_TEXTURE, dayTex);
    loadEarthTexture(NIGHT_TEXTURE, nightTex);

    const earthMaterial = new THREE.ShaderMaterial({
      uniforms: {
        dayTex,
        nightTex,
        sunDirection: this.dayNightUniforms.sunDirection,
      },
      vertexShader: EARTH_VERTEX,
      fragmentShader: EARTH_FRAGMENT,
    });

    const earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS_UNITS, 128, 128);
    const earthMesh = new THREE.Mesh(earthGeometry, earthMaterial);

    const atmosphereMaterial = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: ATMOSPHERE_VERTEX,
      fragmentShader: ATMOSPHERE_FRAGMENT,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS_UNITS * 1.02, 96, 96), atmosphereMaterial);

    this.earthGroup = new THREE.Group();
    this.earthGroup.add(earthMesh);
    this.earthGroup.add(atmosphere);
    this.scene.add(this.earthGroup);

    this.eciGroup = new THREE.Group();
    this.eciGroup.rotation.x = -Math.PI / 2;
    this.scene.add(this.eciGroup);

    const hemisphere = new THREE.HemisphereLight(0x5078ff, 0x01040c, 0.55);
    this.scene.add(hemisphere);

    const ambient = new THREE.AmbientLight(0x1a2f55, 0.35);
    this.scene.add(ambient);

    this.sunLight = new THREE.DirectionalLight(0xfff3d6, 1.45);
    this.sunLight.position.copy(this.dayNightUniforms.sunDirection.value).multiplyScalar(50);
    this.scene.add(this.sunLight);

    const starGeometry = new THREE.SphereGeometry(this.controls.maxDistance, 16, 16);
    const starMaterial = new THREE.MeshBasicMaterial({ color: 0x041024, side: THREE.BackSide });
    const starField = new THREE.Mesh(starGeometry, starMaterial);
    this.scene.add(starField);

    const satGeometry = createSatelliteGeometry();
    satGeometry.computeBoundingSphere();
    if (Number.isFinite(satGeometry.boundingSphere?.radius ?? NaN)) {
      this.satelliteBoundingRadius = satGeometry.boundingSphere?.radius ?? this.satelliteBoundingRadius;
    }
    const satMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.65,
      roughness: 0.35,
      vertexColors: true,
      clearcoat: 0.4,
      clearcoatRoughness: 0.25,
      envMapIntensity: 0.85,
      emissive: new THREE.Color(0x0b162d),
      emissiveIntensity: 0.12,
    });
    this.instancedMesh = new THREE.InstancedMesh(satGeometry, satMaterial, MAX_SATELLITES);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SATELLITES * 3), 3);
    this.eciGroup.add(this.instancedMesh);

    this.issModel = createIssModel();
    if (Number.isFinite(this.issModel.boundingRadius) && this.issModel.boundingRadius > 0) {
      this.issBoundingRadius = this.issModel.boundingRadius;
    }
    this.eciGroup.add(this.issModel.group);

    this.instanceIds = new Int32Array(MAX_SATELLITES);
    this.instanceIds.fill(-1);

    this.container.appendChild(this.renderer.domElement);
    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
  }

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
    this.instancedMesh.geometry.dispose();
    this.instancedMesh.material.dispose();
    for (const mesh of this.issModel.meshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.trailMap.forEach((record) => {
      record.geometry.dispose();
      record.line.material.dispose();
    });
    this.orbitMap.forEach((record) => {
      record.geometry.dispose();
      record.line.material.dispose();
    });
  }

  private handleResize = () => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  updateSatellites(states: SatelliteVisualState[]): void {
    const mesh = this.instancedMesh;
    const colorAttr = mesh.instanceColor;
    if (!colorAttr) return;
    let index = 0;
    let issState: SatelliteVisualState | null = null;
    for (const state of states) {
      if (state.id === ISS_ID) {
        issState = state;
        continue;
      }
      if (index >= MAX_SATELLITES) break;
      if (state.visible === false) continue;
      const [x, y, z] = state.position;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const scale = state.scale ?? 1;
      const position = this.dummyObject.position.set(x, y, z);
      const radius = position.length();
      const minRadius = EARTH_RADIUS_UNITS + scale * this.satelliteBoundingRadius + this.clearancePadding;
      if (Number.isFinite(radius) && radius > 0 && radius < minRadius) {
        position.normalize().multiplyScalar(minRadius);
      }
      this.dummyObject.scale.setScalar(scale);
      if (state.quaternion) {
        this.dummyObject.quaternion.set(...state.quaternion);
      } else {
        this.dummyObject.quaternion.identity();
      }
      this.dummyObject.updateMatrix();
      mesh.setMatrixAt(index, this.dummyObject.matrix);
      this.color.set(state.color);
      colorAttr.setX(index, this.color.r);
      colorAttr.setY(index, this.color.g);
      colorAttr.setZ(index, this.color.b);
      this.instanceIds[index] = state.id;
      index += 1;
    }
    mesh.count = index;
    mesh.instanceMatrix.needsUpdate = true;
    colorAttr.needsUpdate = true;
    for (let i = index; i < MAX_SATELLITES; i += 1) {
      this.instanceIds[i] = -1;
    }

    if (issState && issState.visible !== false) {
      const [x, y, z] = issState.position;
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        this.issModel.group.visible = true;
        const displayScale = issState.scale ?? 1;
        const finalScale = displayScale * ISS_BASE_SCALE;
        this.issModel.group.scale.setScalar(finalScale);
        const position = this.issModel.group.position.set(x, y, z);
        const radius = position.length();
        const minRadius = EARTH_RADIUS_UNITS + finalScale * this.issBoundingRadius + this.clearancePadding;
        if (Number.isFinite(radius) && radius > 0 && radius < minRadius) {
          position.normalize().multiplyScalar(minRadius);
        }
        if (issState.quaternion) {
          this.issModel.group.quaternion.set(...issState.quaternion);
        } else {
          this.issModel.group.quaternion.identity();
        }
        const emissiveIntensity = issState.scale && issState.scale > 1 ? 0.75 : 0.28;
        const highlight = new THREE.Color(issState.color).multiplyScalar(emissiveIntensity);
        for (const meshEntry of this.issModel.meshes) {
          meshEntry.material.emissive.copy(highlight);
        }
      } else {
        this.issModel.group.visible = false;
      }
    } else {
      this.issModel.group.visible = false;
    }
  }

  updateEarthOrientation(gmst: number): void {
    this.earthGroup.rotation.y = gmst;
  }

  /**
   * Points the terminator and key light at the Sun using the low-precision solar position
   * from the Astronomical Almanac (good to about 0.01 degrees, far below what is visible here).
   */
  setSunDirectionFromDate(date: Date): void {
    const days = (date.getTime() - Date.UTC(2000, 0, 1, 12, 0, 0)) / 86_400_000;
    const rad = THREE.MathUtils.degToRad;
    const meanLongitude = 280.46 + 0.9856474 * days;
    const meanAnomaly = rad(357.528 + 0.9856003 * days);
    const eclipticLongitude = rad(meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly));
    const obliquity = rad(23.439 - 0.0000004 * days);
    const direction = eciToScene(
      this.dayNightUniforms.sunDirection.value,
      Math.cos(eclipticLongitude),
      Math.cos(obliquity) * Math.sin(eclipticLongitude),
      Math.sin(obliquity) * Math.sin(eclipticLongitude),
    );
    this.sunLight.position.copy(direction).multiplyScalar(50);
  }

  /** Re-centres the camera on an ECI position, keeping the current viewing direction. */
  focusOn(position: [number, number, number], options?: { radius?: number }): void {
    const [x, y, z] = position;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return;
    }
    const target = eciToScene(this.focusTarget, x, y, z);
    const offset = this.focusOffset.copy(this.camera.position).sub(this.controls.target);
    const minDistance = Math.max(options?.radius ?? EARTH_RADIUS_UNITS * 3, this.controls.minDistance);
    const hasDirection = Number.isFinite(offset.lengthSq()) && offset.lengthSq() > 1e-6;
    if (!hasDirection) {
      offset.set(minDistance * 0.2, minDistance * 0.4, minDistance);
    }
    const currentLength = offset.length();
    if (!Number.isFinite(currentLength) || currentLength < minDistance) {
      offset.setLength(minDistance);
    }
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(offset);
    this.controls.update();
  }

  updateTrails(trails: TrailState[]): void {
    const activeIds = new Set<number>();
    for (const trail of trails) {
      activeIds.add(trail.id);
      let record = this.trailMap.get(trail.id);
      const neededLength = trail.count * 3;
      if (!record) {
        const geometry = new THREE.BufferGeometry();
        const positionAttr = new THREE.BufferAttribute(new Float32Array(neededLength), 3);
        geometry.setAttribute('position', positionAttr);
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(neededLength), 3));
        geometry.setDrawRange(0, trail.count);
        const material = new THREE.LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.65,
          vertexColors: true,
        });
        const line = new THREE.Line(geometry, material);
        line.renderOrder = 1;
        this.eciGroup.add(line);
        record = { geometry, line };
        this.trailMap.set(trail.id, record);
      } else if ((record.geometry.getAttribute('position') as THREE.BufferAttribute).array.length < neededLength) {
        record.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(neededLength), 3));
        record.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(neededLength), 3));
      }
      const positionAttribute = record.geometry.getAttribute('position') as THREE.BufferAttribute;
      positionAttribute.array.set(trail.positions.subarray(0, neededLength));
      positionAttribute.needsUpdate = true;
      record.geometry.setDrawRange(0, trail.count);
      const colorAttribute = record.geometry.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i < trail.count; i += 1) {
        const fade = i / Math.max(1, trail.count - 1);
        const intensity = 0.15 + 0.85 * (1 - fade);
        this.color.copy(TRAIL_COLOR).multiplyScalar(intensity);
        colorAttribute.setXYZ(i, this.color.r, this.color.g, this.color.b);
      }
      colorAttribute.needsUpdate = true;
    }
    for (const [id, record] of this.trailMap) {
      if (!activeIds.has(id)) {
        record.line.parent?.remove(record.line);
        record.geometry.dispose();
        record.line.material.dispose();
        this.trailMap.delete(id);
      }
    }
  }

  updateOrbits(orbits: OrbitState[]): void {
    const activeIds = new Set<number>();
    for (const orbit of orbits) {
      activeIds.add(orbit.id);
      let record = this.orbitMap.get(orbit.id);
      const neededLength = orbit.positions.length;
      if (neededLength < 6) continue;
      if (!record) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(neededLength), 3));
        geometry.setDrawRange(0, neededLength / 3);
        const material = new THREE.LineBasicMaterial({
          color: orbit.color,
          transparent: true,
          opacity: 0.42,
        });
        const line = new THREE.Line(geometry, material);
        line.renderOrder = 0;
        this.eciGroup.add(line);
        record = { geometry, line };
        this.orbitMap.set(orbit.id, record);
      } else {
        const positionAttribute = record.geometry.getAttribute('position') as THREE.BufferAttribute | null;
        if (!positionAttribute || positionAttribute.array.length < neededLength) {
          record.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(neededLength), 3));
        }
        record.line.material.color.setHex(orbit.color);
      }
      const positionAttribute = record.geometry.getAttribute('position') as THREE.BufferAttribute;
      positionAttribute.array.set(orbit.positions);
      positionAttribute.needsUpdate = true;
      record.geometry.setDrawRange(0, orbit.positions.length / 3);
    }
    for (const [id, record] of this.orbitMap) {
      if (!activeIds.has(id)) {
        record.line.parent?.remove(record.line);
        record.geometry.dispose();
        record.line.material.dispose();
        this.orbitMap.delete(id);
      }
    }
  }

  pickSatellite(ndcX: number, ndcY: number): { id: number; distance: number } | null {
    this.raycaster.setFromCamera(this.pointer.set(ndcX, ndcY), this.camera);
    const hits: { id: number; distance: number }[] = [];

    if (this.issModel.group.visible) {
      const issIntersections = this.raycaster.intersectObject(this.issModel.group, true);
      if (issIntersections.length > 0) {
        hits.push({ id: ISS_ID, distance: issIntersections[0].distance });
      }
    }

    const instancedHits = this.raycaster.intersectObject(this.instancedMesh, true);
    if (instancedHits.length > 0) {
      const intersection = instancedHits[0];
      const instanceId = intersection.instanceId ?? -1;
      if (instanceId >= 0) {
        const satelliteId = this.instanceIds[instanceId];
        if (satelliteId >= 0) {
          hits.push({ id: satelliteId, distance: intersection.distance });
        }
      }
    }

    if (hits.length === 0) {
      return null;
    }
    hits.sort((a, b) => a.distance - b.distance);
    return hits[0];
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160/examples/jsm/controls/OrbitControls.js';
import { EARTH_RADIUS_KM } from './sat_sgp4';

export const KM_TO_UNITS = 0.001;
export const EARTH_RADIUS_UNITS = EARTH_RADIUS_KM * KM_TO_UNITS;
const MAX_SATELLITES = 5000;

export interface SatelliteVisualState {
  id: number;
  position: [number, number, number];
  color: number;
  scale?: number;
  visible?: boolean;
}

export interface LabelState {
  id: number;
  text: string;
  position: [number, number, number];
}

export interface TrailState {
  id: number;
  positions: Float32Array;
  count: number;
}

interface TrailRecord {
  geometry: THREE.BufferGeometry;
  line: THREE.Line;
  colorArray: Float32Array;
}

const DAY_TEXTURE = 'https://cdn.jsdelivr.net/gh/raphaellnd/planet-textures@main/8k_earth_daymap.jpg';
const NIGHT_TEXTURE = 'https://cdn.jsdelivr.net/gh/raphaellnd/planet-textures@main/8k_earth_nightmap.jpg';

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
    float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 6.0);
    gl_FragColor = vec4(0.2, 0.45, 1.0, 1.0) * intensity;
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
    float diffuse = max(dot(normalize(vWorldNormal), normalize(sunDirection)), -0.35);
    float mixAmount = smoothstep(-0.2, 0.2, diffuse);
    vec3 color = mix(night * 0.7, day, mixAmount);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export class EarthScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly raycaster: THREE.Raycaster;

  private resizeObserver: ResizeObserver | null = null;
  private readonly instancedMesh: THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly instanceIds: Int32Array;
  private readonly dummyObject: THREE.Object3D;
  private readonly color: THREE.Color;
  private readonly dayNightUniforms: { sunDirection: { value: THREE.Vector3 } };
  private readonly earthGroup: THREE.Group;
  private readonly trailMap = new Map<number, TrailRecord>();
  private readonly labelGroup: THREE.Group;

  constructor(private readonly container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x01040c, 0.04);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200);
    this.camera.position.set(0, EARTH_RADIUS_UNITS * 4, EARTH_RADIUS_UNITS * 8);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = false;
    this.renderer.autoClear = true;
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.pointerEvents = 'auto';

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = EARTH_RADIUS_UNITS * 1.2;
    this.controls.maxDistance = EARTH_RADIUS_UNITS * 80;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    this.raycaster = new THREE.Raycaster();

    this.dummyObject = new THREE.Object3D();
    this.color = new THREE.Color();

    this.dayNightUniforms = { sunDirection: { value: new THREE.Vector3(1, 0, 0) } };

    const dayTexture = new THREE.TextureLoader().load(DAY_TEXTURE);
    dayTexture.colorSpace = THREE.SRGBColorSpace;
    const nightTexture = new THREE.TextureLoader().load(NIGHT_TEXTURE);
    nightTexture.colorSpace = THREE.SRGBColorSpace;

    const earthMaterial = new THREE.ShaderMaterial({
      uniforms: {
        dayTex: { value: dayTexture },
        nightTex: { value: nightTexture },
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

    this.labelGroup = new THREE.Group();
    this.scene.add(this.labelGroup);

    const hemisphere = new THREE.HemisphereLight(0x3454a7, 0x000310, 0.25);
    this.scene.add(hemisphere);

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.1);
    sunLight.castShadow = false;
    sunLight.position.copy(this.dayNightUniforms.sunDirection.value.clone().multiplyScalar(50));
    this.scene.add(sunLight);

    const starGeometry = new THREE.SphereGeometry(this.controls.maxDistance, 16, 16);
    const starMaterial = new THREE.MeshBasicMaterial({ color: 0x010409, side: THREE.BackSide });
    const starField = new THREE.Mesh(starGeometry, starMaterial);
    this.scene.add(starField);

    const satGeometry = new THREE.SphereGeometry(0.03, 12, 12);
    const satMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
    this.instancedMesh = new THREE.InstancedMesh(satGeometry, satMaterial, MAX_SATELLITES);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SATELLITES * 3), 3);
    this.scene.add(this.instancedMesh);

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
    this.trailMap.forEach((record) => {
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
    let index = 0;
    for (const state of states) {
      if (index >= MAX_SATELLITES) break;
      if (state.visible === false) continue;
      const [x, y, z] = state.position;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const scale = state.scale ?? 1;
      this.dummyObject.position.set(x, y, z);
      this.dummyObject.scale.setScalar(scale);
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
  }

  updateEarthOrientation(gmst: number): void {
    this.earthGroup.rotation.y = gmst;
  }

  setSunDirectionFromDate(date: Date): void {
    const msPerDay = 86_400_000;
    const j2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
    const daysSinceJ2000 = (date.getTime() - j2000) / msPerDay;
    const meanAnomaly = (daysSinceJ2000 * (2 * Math.PI)) / 365.25;
    const obliquity = THREE.MathUtils.degToRad(23.44);
    const x = Math.cos(meanAnomaly);
    const y = Math.sin(meanAnomaly) * Math.cos(obliquity);
    const z = Math.sin(meanAnomaly) * Math.sin(obliquity);
    const dir = new THREE.Vector3(-x, -y, -z).normalize();
    this.dayNightUniforms.sunDirection.value.copy(dir);
    const light = this.scene.children.find((child): child is THREE.DirectionalLight => child instanceof THREE.DirectionalLight);
    if (light) {
      light.position.copy(dir.clone().multiplyScalar(50));
    }
  }

  updateLabels(labels: LabelState[]): void {
    const activeIds = new Set<number>();
    for (const label of labels) {
      activeIds.add(label.id);
      let sprite = this.labelGroup.children.find((child) => child.userData?.id === label.id) as THREE.Sprite | undefined;
      if (!sprite) {
        sprite = this.createLabelSprite(label.text);
        sprite.userData.id = label.id;
        this.labelGroup.add(sprite);
      } else if (sprite.userData.text !== label.text) {
        sprite.material.dispose();
        this.labelGroup.remove(sprite);
        sprite = this.createLabelSprite(label.text);
        sprite.userData.id = label.id;
        this.labelGroup.add(sprite);
      }
      sprite.userData.text = label.text;
      const [x, y, z] = label.position;
      sprite.position.set(x, y, z);
    }
    const toRemove: THREE.Object3D[] = [];
    for (const child of this.labelGroup.children) {
      if (!activeIds.has(child.userData?.id)) {
        toRemove.push(child);
      }
    }
    for (const child of toRemove) {
      (child as THREE.Sprite).material.dispose();
      this.labelGroup.remove(child);
    }
  }

  private createLabelSprite(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const size = 256;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = 'rgba(12, 24, 48, 0.65)';
      ctx.strokeStyle = 'rgba(180, 220, 255, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(16, 16, size - 32, size - 32, 18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f7fbff';
      ctx.font = 'bold 64px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, size / 2, size / 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(EARTH_RADIUS_UNITS * 0.35);
    sprite.renderOrder = 2;
    return sprite;
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
        const colorAttr = new THREE.BufferAttribute(new Float32Array(neededLength), 3);
        geometry.setAttribute('position', positionAttr);
        geometry.setAttribute('color', colorAttr);
        geometry.setDrawRange(0, trail.count);
        const material = new THREE.LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.65,
          vertexColors: true,
        });
        const line = new THREE.Line(geometry, material);
        line.renderOrder = 1;
        this.scene.add(line);
        record = {
          geometry,
          line,
          colorArray: colorAttr.array as Float32Array,
        };
        this.trailMap.set(trail.id, record);
      } else if ((record.geometry.getAttribute('position') as THREE.BufferAttribute).array.length < neededLength) {
        record.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(neededLength), 3));
        record.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(neededLength), 3));
        record.colorArray = (record.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
      }
      const positionAttribute = record.geometry.getAttribute('position') as THREE.BufferAttribute;
      positionAttribute.array.set(trail.positions.subarray(0, neededLength));
      positionAttribute.needsUpdate = true;
      record.geometry.setDrawRange(0, trail.count);
      const colorAttribute = record.geometry.getAttribute('color') as THREE.BufferAttribute;
      for (let i = 0; i < trail.count; i += 1) {
        const fade = i / Math.max(1, trail.count - 1);
        const intensity = 0.15 + 0.85 * (1 - fade);
        const base = new THREE.Color(0x7bc0ff);
        this.color.copy(base).multiplyScalar(intensity);
        colorAttribute.setXYZ(i, this.color.r, this.color.g, this.color.b);
      }
      colorAttribute.needsUpdate = true;
    }
    for (const [id, record] of this.trailMap) {
      if (!activeIds.has(id)) {
        record.line.parent?.remove(record.line);
        record.geometry.dispose();
        (record.line.material as THREE.Material).dispose();
        this.trailMap.delete(id);
      }
    }
  }

  pickSatellite(ndcX: number, ndcY: number): { id: number; distance: number } | null {
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const intersections = this.raycaster.intersectObject(this.instancedMesh, true);
    if (intersections.length === 0) return null;
    const intersection = intersections[0];
    const instanceId = intersection.instanceId ?? -1;
    if (instanceId < 0) return null;
    const satelliteId = this.instanceIds[instanceId];
    if (satelliteId < 0) return null;
    return { id: satelliteId, distance: intersection.distance };
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

import * as THREE from 'three';

export interface WowSceneRefs {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  host: HTMLElement;
  celestialRadius: number;
}

export interface WowVectors {
  A: THREE.Vector3;
  B: THREE.Vector3;
}

export interface WowSignalLayer {
  group: THREE.Group;
  setVisible(visible: boolean): void;
  getVectors(): WowVectors;
}

export const WOW_SIGNAL_COORDINATES = {
  hornA: {
    raDeg: 291.3791666667,
    raHms: '19h 25m 31s',
    decDeg: -26.95,
    label: 'Wow! Signal — 1977-08-15 — Horn A',
    raDegLabel: '291.3791666667°',
  },
  hornB: {
    raDeg: 292.0916666667,
    raHms: '19h 28m 22s',
    decDeg: -26.95,
    label: 'Wow! Signal — 1977-08-15 — Horn B',
    raDegLabel: '292.0916666667°',
  },
} as const;

const TOOLTIP_NOTE = 'Direction in Sagittarius. RA is ambiguous because Big Ear used dual feed horns.';
const TOOLTIP_FRAME = 'J2000; RA ambiguous due to dual horns';

const COLORS = {
  anchorBase: new THREE.Color(0xf8fafc),
  anchorEmissive: new THREE.Color(0xfdf5c2),
  anchorHighlight: new THREE.Color(0xfde68a),
  lineBase: new THREE.Color(0x38bdf8),
  lineHighlight: new THREE.Color(0xfacc15),
  lineBaseOpacity: 0.72,
  lineHighlightOpacity: 0.95,
} as const;

const CELESTIAL_TO_EARTH_ORBIT_RATIO = 24;
const EARTH_ORBIT_CLEARANCE = 1.02;
const LINE_THICKNESS_RATIO = 0.0012;
const LINE_BASE_EMISSIVE = COLORS.lineBase.clone().multiplyScalar(0.25);
const LINE_HOVER_EMISSIVE = COLORS.lineHighlight.clone().multiplyScalar(0.35);
const LINE_PINNED_EMISSIVE = COLORS.lineHighlight.clone().multiplyScalar(0.45);

const DEG_TO_RAD = Math.PI / 180;

export function radecToVector3(raDeg: number, decDeg: number, radius: number): THREE.Vector3 {
  const ra = raDeg * DEG_TO_RAD;
  const dec = decDeg * DEG_TO_RAD;
  const cosDec = Math.cos(dec);
  const x = cosDec * Math.cos(ra);
  const y = Math.sin(dec);
  const z = cosDec * Math.sin(ra);
  return new THREE.Vector3(x * radius, y * radius, z * radius);
}

type VisualState = 'idle' | 'hover' | 'pinned';

interface CandidateSpec {
  key: 'A' | 'B';
  label: string;
  raDeg: number;
  decDeg: number;
  raHms: string;
  raDegLabel: string;
}

interface CandidateNode {
  spec: CandidateSpec;
  group: THREE.Group;
  line: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
  anchor: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  label: THREE.Sprite;
  worldPosition: THREE.Vector3;
  startPosition: THREE.Vector3;
  normal: THREE.Vector3;
  tooltip: string;
  state: VisualState;
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, width: number, height: number, radius: number): void {
  const r = Math.min(radius, Math.min(width, height) / 2);
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(width - r, 0);
  ctx.quadraticCurveTo(width, 0, width, r);
  ctx.lineTo(width, height - r);
  ctx.quadraticCurveTo(width, height, width - r, height);
  ctx.lineTo(r, height);
  ctx.quadraticCurveTo(0, height, 0, height - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
}

function createLabelSprite(text: string, scale: number): THREE.Sprite {
  if (typeof document === 'undefined') {
    const fallbackMaterial = new THREE.SpriteMaterial({
      color: 0xf8fafc,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(fallbackMaterial);
    sprite.scale.set(scale, scale * 0.32, 1);
    sprite.center.set(0, 0.5);
    sprite.renderOrder = 20;
    return sprite;
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    const fallbackMaterial = new THREE.SpriteMaterial({
      color: 0xf8fafc,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(fallbackMaterial);
    sprite.scale.set(scale, scale * 0.32, 1);
    sprite.center.set(0, 0.5);
    sprite.renderOrder = 20;
    return sprite;
  }

  const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
  const padding = 36;
  const fontSize = 60;
  const font = `600 ${fontSize}px "Inter", "Segoe UI", "Helvetica Neue", sans-serif`;
  context.font = font;
  const textWidth = context.measureText(text).width;
  const boxWidth = textWidth + padding * 2;
  const boxHeight = fontSize * 1.4 + padding * 2;
  canvas.width = Math.ceil(boxWidth * ratio);
  canvas.height = Math.ceil(boxHeight * ratio);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const fallbackMaterial = new THREE.SpriteMaterial({
      color: 0xf8fafc,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(fallbackMaterial);
    sprite.scale.set(scale, scale * 0.32, 1);
    sprite.center.set(0, 0.5);
    sprite.renderOrder = 20;
    return sprite;
  }

  ctx.scale(ratio, ratio);
  ctx.font = font;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
  drawRoundedRect(ctx, boxWidth, boxHeight, 28);
  ctx.fill();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.fillStyle = '#f8fafc';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, padding, boxHeight / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

  const sprite = new THREE.Sprite(material);
  const aspect = boxHeight / boxWidth;
  sprite.scale.set(scale, scale * aspect, 1);
  sprite.center.set(0, 0.5);
  sprite.renderOrder = 20;
  return sprite;
}

function buildCandidate(spec: CandidateSpec, radius: number): CandidateNode {
  const worldPosition = radecToVector3(spec.raDeg, spec.decDeg, radius);
  const normal = worldPosition.clone().normalize();
  const group = new THREE.Group();
  group.name = spec.label;

  const earthOrbitRadius = radius / CELESTIAL_TO_EARTH_ORBIT_RATIO;
  const startDistance = Math.min(radius * 0.95, earthOrbitRadius * EARTH_ORBIT_CLEARANCE);
  const startPosition = normal.clone().multiplyScalar(startDistance);
  const direction = worldPosition.clone().sub(startPosition);
  const lineLength = direction.length();
  const lineRadius = Math.max(lineLength * LINE_THICKNESS_RATIO, earthOrbitRadius * 0.015);
  direction.normalize();

  const lineGeometry = new THREE.CylinderGeometry(lineRadius, lineRadius, lineLength, 32, 1, false);
  lineGeometry.translate(0, lineLength / 2, 0);
  const lineMaterial = new THREE.MeshStandardMaterial({
    color: COLORS.lineBase,
    emissive: LINE_BASE_EMISSIVE.clone(),
    emissiveIntensity: 0.65,
    roughness: 0.45,
    metalness: 0.18,
    transparent: true,
    opacity: COLORS.lineBaseOpacity,
    toneMapped: false,
  });
  const line = new THREE.Mesh(lineGeometry, lineMaterial);
  line.position.copy(startPosition);
  const align = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  line.quaternion.copy(align);
  line.castShadow = false;
  line.receiveShadow = false;
  line.name = `${spec.label} Direction`;

  const anchorRadius = earthOrbitRadius * 0.045;
  const anchorGeometry = new THREE.SphereGeometry(anchorRadius, 32, 24);
  const anchorMaterial = new THREE.MeshStandardMaterial({
    color: COLORS.anchorBase,
    emissive: COLORS.anchorEmissive,
    emissiveIntensity: 0.78,
    roughness: 0.3,
    metalness: 0.1,
    toneMapped: false,
  });
  const anchor = new THREE.Mesh(anchorGeometry, anchorMaterial);
  anchor.position.copy(startPosition);
  anchor.castShadow = false;
  anchor.receiveShadow = false;
  anchor.name = `${spec.label} Anchor`;

  const labelScale = radius * 0.14;
  const label = createLabelSprite(spec.label, labelScale);
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(up, normal);
  if (right.lengthSq() < 1e-6) {
    right.set(1, 0, 0);
  }
  right.normalize();
  const labelOffset = normal.clone().multiplyScalar(radius * 0.05);
  const lateralOffset = right.multiplyScalar(radius * 0.03);
  label.position.copy(worldPosition).add(labelOffset).add(lateralOffset);
  label.name = `${spec.label} Label`;

  group.add(line, anchor, label);

  const tooltip = [
    spec.label,
    `RA ${spec.raHms} (${spec.raDegLabel})`,
    `Dec ${spec.decDeg < 0 ? '−' : ''}${Math.abs(spec.decDeg).toFixed(2)}°`,
    TOOLTIP_FRAME,
    TOOLTIP_NOTE,
  ].join('\n');

  return {
    spec,
    group,
    line,
    anchor,
    label,
    worldPosition,
    startPosition,
    normal,
    tooltip,
    state: 'idle',
  };
}

function formatTooltip(spec: CandidateSpec): string {
  const decSign = spec.decDeg < 0 ? '−' : '';
  const decValue = `${decSign}${Math.abs(spec.decDeg).toFixed(2)}°`;
  return [spec.label, `RA ${spec.raHms} (${spec.raDegLabel})`, `Dec ${decValue}`, TOOLTIP_FRAME, TOOLTIP_NOTE].join('\n');
}

export function createWowSignalLayer(refs: WowSceneRefs): WowSignalLayer {
  const candidates: CandidateSpec[] = [
    {
      key: 'A',
      label: WOW_SIGNAL_COORDINATES.hornA.label,
      raDeg: WOW_SIGNAL_COORDINATES.hornA.raDeg,
      decDeg: WOW_SIGNAL_COORDINATES.hornA.decDeg,
      raHms: WOW_SIGNAL_COORDINATES.hornA.raHms,
      raDegLabel: WOW_SIGNAL_COORDINATES.hornA.raDegLabel,
    },
    {
      key: 'B',
      label: WOW_SIGNAL_COORDINATES.hornB.label,
      raDeg: WOW_SIGNAL_COORDINATES.hornB.raDeg,
      decDeg: WOW_SIGNAL_COORDINATES.hornB.decDeg,
      raHms: WOW_SIGNAL_COORDINATES.hornB.raHms,
      raDegLabel: WOW_SIGNAL_COORDINATES.hornB.raDegLabel,
    },
  ];

  const group = new THREE.Group();
  group.name = 'WowSignalLayer';

  const nodes = candidates.map((spec) => buildCandidate(spec, refs.celestialRadius));
  for (const node of nodes) {
    node.tooltip = formatTooltip(node.spec);
    group.add(node.group);
  }

  const meshToNode = new Map<THREE.Object3D, CandidateNode>();
  const pickables: THREE.Object3D[] = [];
  for (const node of nodes) {
    meshToNode.set(node.line, node);
    meshToNode.set(node.anchor, node);
    pickables.push(node.line, node.anchor);
  }

  const tooltip = document.createElement('div');
  tooltip.className = 'wow-tooltip';
  Object.assign(tooltip.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    pointerEvents: 'none',
    padding: '8px 12px',
    fontSize: '13px',
    lineHeight: '18px',
    fontWeight: '500',
    color: '#f8fafc',
    background: 'rgba(15, 23, 42, 0.88)',
    borderRadius: '8px',
    boxShadow: '0 10px 24px rgba(15, 23, 42, 0.45)',
    whiteSpace: 'pre-line',
    opacity: '0',
    transition: 'opacity 0.16s ease',
    zIndex: '1200',
    transform: 'translate(-9999px, -9999px)',
    border: '1px solid rgba(148, 163, 184, 0.55)',
    maxWidth: '320px',
  });
  refs.host.appendChild(tooltip);

  let visible = true;
  let hovered: CandidateNode | null = null;
  let pinned: CandidateNode | null = null;
  let tooltipMode: 'pointer' | 'world' | null = null;
  let pointerDownNode: CandidateNode | null = null;
  const pointer = new THREE.Vector2();
  const pointerViewport = { x: 0, y: 0 };
  const raycaster = new THREE.Raycaster();
  const projected = new THREE.Vector3();

  const updateMaterials = (node: CandidateNode, state: VisualState) => {
    if (node.state === state) return;
    node.state = state;
    const lineMaterial = node.line.material;
    const anchorMaterial = node.anchor.material;
    const spriteMaterial = node.label.material as THREE.SpriteMaterial;
    if (state === 'idle') {
      anchorMaterial.emissive.copy(COLORS.anchorEmissive);
      anchorMaterial.emissiveIntensity = 0.78;
      lineMaterial.color.copy(COLORS.lineBase);
      lineMaterial.opacity = COLORS.lineBaseOpacity;
      lineMaterial.emissive.copy(LINE_BASE_EMISSIVE);
      lineMaterial.emissiveIntensity = 0.65;
      spriteMaterial.opacity = 0.92;
    } else if (state === 'hover') {
      anchorMaterial.emissive.copy(COLORS.anchorHighlight);
      anchorMaterial.emissiveIntensity = 1.2;
      lineMaterial.color.copy(COLORS.lineHighlight);
      lineMaterial.opacity = COLORS.lineHighlightOpacity;
      lineMaterial.emissive.copy(LINE_HOVER_EMISSIVE);
      lineMaterial.emissiveIntensity = 0.85;
      spriteMaterial.opacity = 1;
    } else {
      anchorMaterial.emissive.copy(COLORS.anchorHighlight);
      anchorMaterial.emissiveIntensity = 1.45;
      lineMaterial.color.copy(COLORS.lineHighlight);
      lineMaterial.opacity = COLORS.lineHighlightOpacity;
      lineMaterial.emissive.copy(LINE_PINNED_EMISSIVE);
      lineMaterial.emissiveIntensity = 1.05;
      spriteMaterial.opacity = 1;
    }
  };

  const showTooltip = (text: string): void => {
    if (tooltip.textContent !== text) {
      tooltip.textContent = text;
    }
    tooltip.style.opacity = '1';
    tooltip.style.visibility = 'visible';
  };

  const hideTooltip = (): void => {
    tooltip.style.opacity = '0';
    tooltip.style.visibility = 'hidden';
    tooltip.style.transform = 'translate(-9999px, -9999px)';
  };

  const clampToHost = (x: number, y: number): { x: number; y: number } => {
    const hostRect = refs.host.getBoundingClientRect();
    const padding = 12;
    const width = tooltip.offsetWidth || 0;
    const height = tooltip.offsetHeight || 0;
    const minX = hostRect.left + padding;
    const maxX = hostRect.right - width - padding;
    const minY = hostRect.top + padding;
    const maxY = hostRect.bottom - height - padding;
    return {
      x: Math.min(maxX, Math.max(minX, x)),
      y: Math.min(maxY, Math.max(minY, y)),
    };
  };

  const positionTooltipAtPointer = () => {
    const pos = clampToHost(pointerViewport.x + 16, pointerViewport.y + 16);
    tooltip.style.transform = `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px)`;
  };

  const positionTooltipAtWorld = (node: CandidateNode) => {
    const rect = refs.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      hideTooltip();
      return;
    }
    projected.copy(node.worldPosition);
    projected.project(refs.camera);
    if (projected.z < -1 || projected.z > 1) {
      hideTooltip();
      return;
    }
    const x = rect.left + ((projected.x + 1) / 2) * rect.width;
    const y = rect.top + ((-projected.y + 1) / 2) * rect.height;
    const pos = clampToHost(x + 14, y + 14);
    tooltip.style.transform = `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px)`;
  };

  const pickNode = (): CandidateNode | null => {
    raycaster.setFromCamera(pointer, refs.camera);
    const hits = raycaster.intersectObjects(pickables, false);
    for (const hit of hits) {
      if (hit.object.visible) {
        const node = meshToNode.get(hit.object);
        if (node) return node;
      }
    }
    return null;
  };

  const setHovered = (node: CandidateNode | null) => {
    if (hovered === node) return;
    const previous = hovered;
    hovered = node;
    if (previous && previous !== pinned) {
      updateMaterials(previous, 'idle');
    }
    if (node && node !== pinned) {
      updateMaterials(node, 'hover');
    }
  };

  const setPinned = (node: CandidateNode | null) => {
    if (pinned === node) return;
    const previous = pinned;
    pinned = node;
    if (previous && previous !== hovered) {
      updateMaterials(previous, hovered === previous ? 'hover' : 'idle');
    }
    if (node) {
      updateMaterials(node, 'pinned');
    }
  };

  const updatePointer = (event: PointerEvent | MouseEvent) => {
    const rect = refs.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }
    pointerViewport.x = event.clientX;
    pointerViewport.y = event.clientY;
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    return true;
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!visible || !updatePointer(event)) return;
    const node = pickNode();
    if (node) {
      setHovered(node);
      if (!pinned || pinned === node) {
        tooltipMode = pinned ? 'world' : 'pointer';
        showTooltip(node.tooltip);
        if (pinned) {
          positionTooltipAtWorld(node);
        } else {
          positionTooltipAtPointer();
        }
      }
    } else {
      if (!pinned) {
        setHovered(null);
        hideTooltip();
        tooltipMode = null;
      } else {
        tooltipMode = 'world';
        showTooltip(pinned.tooltip);
        positionTooltipAtWorld(pinned);
      }
    }
  };

  const handlePointerLeave = () => {
    pointerDownNode = null;
    setHovered(null);
    if (!pinned) {
      hideTooltip();
      tooltipMode = null;
    }
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (!visible || event.button !== 0) return;
    if (!updatePointer(event)) return;
    const node = pickNode();
    pointerDownNode = node;
    if (node) {
      event.stopPropagation();
      event.preventDefault();
    }
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (!visible || event.button !== 0) {
      pointerDownNode = null;
      return;
    }
    if (!updatePointer(event)) {
      pointerDownNode = null;
      return;
    }
    const node = pickNode();
    if (pointerDownNode && node === pointerDownNode) {
      if (pinned === node) {
        setPinned(null);
        tooltipMode = null;
        if (!hovered) {
          hideTooltip();
        } else if (hovered) {
          tooltipMode = 'pointer';
          showTooltip(hovered.tooltip);
          positionTooltipAtPointer();
        }
      } else {
        setPinned(node);
        tooltipMode = 'world';
        showTooltip(node.tooltip);
        positionTooltipAtWorld(node);
      }
      event.stopPropagation();
      event.preventDefault();
    } else if (!node && !pointerDownNode && pinned) {
      setPinned(null);
      tooltipMode = null;
      hideTooltip();
    }
    pointerDownNode = null;
  };

  const handleClick = (event: MouseEvent) => {
    if (!visible) return;
    if (!updatePointer(event)) return;
    if (!pickNode() && pinned) {
      setPinned(null);
      tooltipMode = null;
      hideTooltip();
    }
  };

  refs.renderer.domElement.addEventListener('pointermove', handlePointerMove);
  refs.renderer.domElement.addEventListener('pointerleave', handlePointerLeave);
  refs.renderer.domElement.addEventListener('pointerdown', handlePointerDown, true);
  refs.renderer.domElement.addEventListener('pointerup', handlePointerUp, true);
  refs.renderer.domElement.addEventListener('click', handleClick, true);

  group.onBeforeRender = () => {
    if (!visible) return;
    if (tooltipMode === 'world' && pinned) {
      positionTooltipAtWorld(pinned);
    }
  };

  const setVisible = (next: boolean) => {
    visible = next;
    group.visible = next;
    for (const node of nodes) {
      node.group.visible = next;
    }
    if (!visible) {
      setHovered(null);
      setPinned(null);
      hideTooltip();
      tooltipMode = null;
    }
  };

  const getVectors = (): WowVectors => ({
    A: nodes[0].worldPosition.clone(),
    B: nodes[1].worldPosition.clone(),
  });

  if (typeof window !== 'undefined') {
    const api: WowDebugApi = {
      setVisible: (value: boolean) => {
        setVisible(value);
      },
      getVectors,
    };
    (window as WindowWithWow).__wow = api;
  }

  return {
    group,
    setVisible,
    getVectors,
  };
}

export type WowDebugApi = {
  setVisible: (visible: boolean) => void;
  getVectors: () => WowVectors;
};

type WindowWithWow = Window & { __wow?: WowDebugApi };

declare global {
  interface Window {
    __wow?: WowDebugApi;
  }
}

/** Inline SVG illustrations, one per planet class. Pure string builders with no DOM access. */

function svgBase(inner: string, gradient = '', defs = ''): string {
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-hidden="true">
  <defs>
    ${gradient}
    ${defs}
    <!-- Rim light and atmosphere glow -->
    <filter id="atmo" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="blur" />
      <feSpecularLighting in="blur" surfaceScale="5" specularConstant="1" specularExponent="20" lighting-color="#ffffff" result="specOut">
        <fePointLight x="-500" y="-100" z="300" />
      </feSpecularLighting>
      <feComposite in="specOut" in2="SourceAlpha" operator="in" result="specOut" />
      <feComposite in="SourceGraphic" in2="specOut" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="litPaint" />
      <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="ambientGlow" />
      <feMerge>
        <feMergeNode in="ambientGlow" />
        <feMergeNode in="litPaint" />
      </feMerge>
    </filter>
    <clipPath id="planetClip">
      <circle cx="80" cy="80" r="78" />
    </clipPath>
  </defs>
  <g filter="url(#atmo)">
    ${inner}
  </g>
</svg>
`;
}

function svgAirlessDwarf(): string {
  const gradient = `
<radialGradient id="airlessGrad" cx="60%" cy="40%" r="75%">
  <stop offset="0%" stop-color="#e0d8cf" />
  <stop offset="60%" stop-color="#8a7f73" />
  <stop offset="100%" stop-color="#423a35" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="50" fill="url(#airlessGrad)" />
<!-- Craters -->
<g fill="rgba(0,0,0,0.25)" stroke="rgba(255,255,255,0.1)" stroke-width="1">
  <ellipse cx="60" cy="65" rx="10" ry="8" transform="rotate(-15 60 65)" />
  <ellipse cx="95" cy="55" rx="7" ry="5" />
  <ellipse cx="110" cy="90" rx="8" ry="6" transform="rotate(20 110 90)" />
  <circle cx="85" cy="105" r="4" />
  <circle cx="45" cy="90" r="3" />
</g>
`;
  return svgBase(inner, gradient);
}

function svgLavaWorld(): string {
  const gradient = `
<radialGradient id="lavaGrad" cx="50%" cy="50%" r="65%" fx="40%" fy="40%">
  <stop offset="0%" stop-color="#ff4d00" />
  <stop offset="50%" stop-color="#8c2200" />
  <stop offset="100%" stop-color="#2b0a00" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="60" fill="#3d1a1a" />
<!-- Molten Cracks -->
<g stroke-linecap="round" fill="none" filter="blur(0.5px)">
  <path d="M30 70 Q 50 100, 90 90 T 140 80" stroke="#ff9100" stroke-width="5" opacity="0.8"/>
  <path d="M30 70 Q 50 100, 90 90 T 140 80" stroke="#ffff00" stroke-width="2" />
  
  <path d="M60 30 Q 80 60, 110 50" stroke="#ff5500" stroke-width="4" opacity="0.7" />
  <path d="M60 30 Q 80 60, 110 50" stroke="#ffcc00" stroke-width="1.5" />
  
  <path d="M50 120 Q 90 110, 120 130" stroke="#ff2a00" stroke-width="6" opacity="0.6" />
  <path d="M50 120 Q 90 110, 120 130" stroke="#ff8800" stroke-width="2" />
</g>
<circle cx="80" cy="80" r="60" fill="url(#lavaGrad)" opacity="0.5" style="mix-blend-mode: overlay;" />
`;
  return svgBase(inner, gradient);
}

function svgTemperateTerrestrial(): string {
  const gradient = `
<radialGradient id="oceanGrad" cx="50%" cy="50%" r="70%" fx="30%" fy="30%">
  <stop offset="0%" stop-color="#4facfe" />
  <stop offset="100%" stop-color="#003a7d" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="62" fill="url(#oceanGrad)" />
<!-- Continents -->
<g fill="#3a7d44" opacity="0.9" clip-path="url(#planetClip)">
   <path d="M50 40 Q 70 20, 100 50 T 140 60 L 150 100 Q 100 120, 60 100 T 30 70 Z" />
   <path d="M10 90 Q 30 80, 50 110 T 40 150 L 10 140 Z" fill="#5a4d3a"/>
</g>
<!-- Clouds -->
<g fill="#ffffff" opacity="0.4" filter="blur(2px)">
  <path d="M20 80 Q 50 60, 90 85 T 150 70" stroke="#fff" stroke-width="12" fill="none"/>
  <path d="M40 40 Q 70 30, 110 45" stroke="#fff" stroke-width="8" fill="none"/>
  <path d="M30 120 Q 80 130, 130 115" stroke="#fff" stroke-width="10" fill="none"/>
</g>
`;
  return svgBase(inner, gradient);
}

function svgMegaEarth(): string {
  const gradient = `
<radialGradient id="megaGrad" cx="50%" cy="50%" r="70%" fx="25%" fy="25%">
  <stop offset="0%" stop-color="#8ecae6" />
  <stop offset="100%" stop-color="#023047" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="70" fill="url(#megaGrad)" />
<!-- Thick Atmosphere Bands -->
<g opacity="0.2" fill="none" stroke="#fff" stroke-width="20" clip-path="url(#planetClip)">
  <path d="M-20 60 Q 80 80, 180 60" />
  <path d="M-20 100 Q 80 120, 180 100" />
</g>
<circle cx="80" cy="80" r="68" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.3" />
`;
  return svgBase(inner, gradient);
}

function svgHotSuperEarth(): string {
  const gradient = `
<linearGradient id="dayNight" x1="0%" y1="50%" x2="100%" y2="50%">
  <stop offset="30%" stop-color="#fff5e0" /> <!-- Day side -->
  <stop offset="50%" stop-color="#ff5e62" /> <!-- Terminator -->
  <stop offset="85%" stop-color="#240b36" /> <!-- Night side -->
</linearGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="65" fill="url(#dayNight)" transform="rotate(-30 80 80)"/>
<!-- Evaporating atmosphere tail hint -->
<path d="M 30 30 Q 0 0, -20 -20" stroke="#fff5e0" stroke-width="10" opacity="0.1" filter="blur(5px)"/>
`;
  return svgBase(inner, gradient);
}

function svgHotSubNeptune(): string {
  const gradient = `
<radialGradient id="hotSnGrad" cx="50%" cy="50%" r="65%" fx="40%" fy="30%">
  <stop offset="0%" stop-color="#ffecd2" />
  <stop offset="50%" stop-color="#fcb69f" />
  <stop offset="100%" stop-color="#c72c48" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="68" fill="url(#hotSnGrad)" />
<!-- Puffed up haze layers -->
<circle cx="80" cy="80" r="68" fill="none" stroke="#ffecd2" stroke-width="4" opacity="0.2" />
<circle cx="80" cy="80" r="64" fill="none" stroke="#fcb69f" stroke-width="4" opacity="0.1" />
`;
  return svgBase(inner, gradient);
}

function svgColdSubNeptune(): string {
  const gradient = `
<radialGradient id="coldSnGrad" cx="50%" cy="50%" r="70%" fx="30%" fy="30%">
  <stop offset="0%" stop-color="#e0f7fa" />
  <stop offset="100%" stop-color="#006064" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="68" fill="url(#coldSnGrad)" />
<!-- Methane clouds -->
<g fill="#b2ebf2" opacity="0.3" filter="blur(3px)" clip-path="url(#planetClip)">
  <ellipse cx="60" cy="50" rx="40" ry="10" />
  <ellipse cx="100" cy="80" rx="50" ry="12" />
  <ellipse cx="70" cy="110" rx="40" ry="8" />
</g>
`;
  return svgBase(inner, gradient);
}

function svgWarmNeptune(): string {
  const gradient = `
<radialGradient id="warmNepGrad" cx="50%" cy="40%" r="70%">
  <stop offset="0%" stop-color="#d1c4e9" />
  <stop offset="60%" stop-color="#7e57c2" />
  <stop offset="100%" stop-color="#311b92" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="70" fill="url(#warmNepGrad)" />
<!-- Dark Spot -->
<ellipse cx="110" cy="60" rx="15" ry="8" fill="#311b92" opacity="0.6" filter="blur(1px)" transform="rotate(-10 110 60)" />
<!-- High wispy clouds -->
<path d="M40 90 Q 80 100, 120 90" stroke="#ede7f6" stroke-width="3" fill="none" opacity="0.4" filter="blur(1px)" />
`;
  return svgBase(inner, gradient);
}

function svgUltraHotJupiter(): string {
  const gradient = `
<radialGradient id="uhjGrad" cx="30%" cy="30%" r="80%">
  <stop offset="0%" stop-color="#fff9c4" />
  <stop offset="40%" stop-color="#fbc02d" />
  <stop offset="100%" stop-color="#bf360c" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="75" fill="url(#uhjGrad)" />
<!-- Intense heat bands representing supersonic winds -->
<g stroke-width="2" stroke="#fff" opacity="0.2" fill="none">
  <path d="M0 60 Q 80 60, 160 60" />
  <path d="M0 100 Q 80 100, 160 100" />
  <path d="M0 80 Q 80 80, 160 80" />
</g>
`;
  return svgBase(inner, gradient);
}

function svgColdGasGiant(): string {
  const gradient = `
<radialGradient id="coldGasGrad" cx="40%" cy="40%" r="70%">
  <stop offset="0%" stop-color="#b3e5fc" />
  <stop offset="100%" stop-color="#01579b" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="72" fill="url(#coldGasGrad)" />
<!-- Subtle bands -->
<g fill="none" stroke="#0288d1" stroke-width="8" opacity="0.15" clip-path="url(#planetClip)">
  <rect x="0" y="40" width="160" height="20" />
  <rect x="0" y="100" width="160" height="20" />
</g>
<!-- Ring system -->
<g transform="rotate(-20 80 80)" opacity="0.8">
  <ellipse cx="80" cy="80" rx="95" ry="25" fill="none" stroke="#e1f5fe" stroke-width="2" opacity="0.4"/>
  <ellipse cx="80" cy="80" rx="90" ry="20" fill="none" stroke="#b3e5fc" stroke-width="6" opacity="0.6"/>
  <!-- Mask part of ring behind planet -->
  <path d="M 15 80 A 65 25 0 0 0 145 80" stroke="#b3e5fc" stroke-width="6" fill="none" opacity="0.6" />
</g>
<!-- Redraw planet top half over back ring -->
<path d="M 10 80 A 70 70 0 0 1 150 80" fill="url(#coldGasGrad)" clip-path="url(#planetClip)" transform="rotate(-20 80 80)"/>
`;
  return svgBase(inner, gradient);
}

function svgRocky(): string {
  const gradient = `
<radialGradient id="rockyGrad" cx="60%" cy="40%" r="70%">
  <stop offset="0%" stop-color="#d7ccc8" />
  <stop offset="60%" stop-color="#8d6e63" />
  <stop offset="100%" stop-color="#3e2723" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="58" fill="url(#rockyGrad)" />
<!-- Tectonic features -->
<path d="M50 40 Q 70 60, 40 90 T 70 130" stroke="#5d4037" stroke-width="2" fill="none" opacity="0.5" />
<path d="M100 30 Q 120 70, 100 110" stroke="#3e2723" stroke-width="3" fill="none" opacity="0.3" />
`;
  return svgBase(inner, gradient);
}

function svgSuperEarth(): string {
  const gradient = `
<radialGradient id="seGrad" cx="40%" cy="40%" r="75%">
  <stop offset="0%" stop-color="#80deea" />
  <stop offset="100%" stop-color="#006064" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="64" fill="url(#seGrad)" />
<!-- Swirling cloud patterns -->
<g stroke="#e0f7fa" stroke-width="4" fill="none" opacity="0.3" filter="blur(2px)">
   <path d="M30 50 C 50 30, 110 30, 130 50" />
   <path d="M20 80 C 60 60, 100 100, 140 80" />
   <path d="M40 110 C 60 130, 100 130, 120 110" />
</g>
`;
  return svgBase(inner, gradient);
}

function svgSubNeptune(): string {
  const gradient = `
<radialGradient id="snGrad" cx="50%" cy="45%" r="70%">
  <stop offset="0%" stop-color="#b39ddb" />
  <stop offset="100%" stop-color="#4527a0" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="66" fill="url(#snGrad)" />
<!-- Hazy bands -->
<rect x="0" y="60" width="160" height="40" fill="#673ab7" opacity="0.2" clip-path="url(#planetClip)" />
`;
  return svgBase(inner, gradient);
}

function svgNeptune(): string {
  const gradient = `
<radialGradient id="nepGrad" cx="50%" cy="50%" r="70%" fx="30%" fy="30%">
  <stop offset="0%" stop-color="#448aff" />
  <stop offset="100%" stop-color="#1a237e" />
</radialGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="68" fill="url(#nepGrad)" />
<!-- Great Dark Spot & Clouds -->
<ellipse cx="50" cy="100" rx="12" ry="8" fill="#1a237e" opacity="0.5" filter="blur(1px)" />
<path d="M80 40 Q 110 30, 140 45" stroke="#fff" stroke-width="3" fill="none" opacity="0.5" filter="blur(1px)"/>
<path d="M90 60 Q 120 55, 150 65" stroke="#fff" stroke-width="2" fill="none" opacity="0.3" filter="blur(1px)"/>
`;
  return svgBase(inner, gradient);
}

function svgGasGiant(): string {
  const gradient = `
<radialGradient id="gasGrad" cx="40%" cy="40%" r="72%">
  <stop offset="0%" stop-color="#ffe0b2" />
  <stop offset="100%" stop-color="#e65100" />
</radialGradient>
`;
  const defs = `
<linearGradient id="bands" x1="0" x2="0" y1="0" y2="1">
  <stop offset="0%" stop-color="#ffcc80" />
  <stop offset="20%" stop-color="#ef6c00" />
  <stop offset="40%" stop-color="#ffe0b2" />
  <stop offset="50%" stop-color="#e65100" />
  <stop offset="60%" stop-color="#ffe0b2" />
  <stop offset="80%" stop-color="#ef6c00" />
  <stop offset="100%" stop-color="#ffcc80" />
</linearGradient>
`;
  const inner = `
<circle cx="80" cy="80" r="72" fill="url(#bands)" transform="rotate(-15 80 80)" />
<circle cx="80" cy="80" r="72" fill="url(#gasGrad)" opacity="0.5" style="mix-blend-mode: multiply;" />
<!-- Great Red Spot -->
<ellipse cx="110" cy="100" rx="18" ry="10" fill="#bf360c" opacity="0.8" transform="rotate(-15 110 100)" />
`;
  return svgBase(inner, gradient, defs);
}

function svgUnknown(): string {
  const inner = `
<circle cx="80" cy="80" r="56" fill="#263238" stroke="#37474f" stroke-width="4" />
<text x="80" y="100" text-anchor="middle" font-size="60" font-family="sans-serif" font-weight="bold" fill="#546e7a">?</text>
`;
  return svgBase(inner);
}

export const PLANET_ART = {
  unknown: svgUnknown,
  'lava-world': svgLavaWorld,
  'airless-dwarf': svgAirlessDwarf,
  'temperate-terrestrial': svgTemperateTerrestrial,
  rocky: svgRocky,
  'mega-earth': svgMegaEarth,
  'hot-super-earth': svgHotSuperEarth,
  'super-earth': svgSuperEarth,
  'hot-sub-neptune': svgHotSubNeptune,
  'cold-sub-neptune': svgColdSubNeptune,
  'sub-neptune': svgSubNeptune,
  'warm-neptune': svgWarmNeptune,
  neptune: svgNeptune,
  'ultra-hot-jupiter': svgUltraHotJupiter,
  'cold-gas-giant': svgColdGasGiant,
  'gas-giant': svgGasGiant,
} satisfies Record<string, () => string>;

export type PlanetArtKey = keyof typeof PLANET_ART;

/** Returns the illustration for a planet class, tagged with its CSS class. */
export function planetArt(key: PlanetArtKey): string {
  return PLANET_ART[key]().replace('<svg', `<svg class="${key}"`);
}

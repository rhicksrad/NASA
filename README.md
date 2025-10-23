# NASA Open APIs Visualization Hub

This project renders interactive NASA datasets, combining custom Three.js scenes with data from the NASA API gateway and a Cloudflare Worker proxy. The NEO3D experience visualizes near-Earth objects, planetary orbits, and supporting overlays inside a responsive Vite/TypeScript application.

## Wow! Signal Overlay

The NEO3D scene now includes a Wow! Signal overlay that highlights the two Big Ear feed horn candidates recorded on 1977-08-15. The overlay is enabled by default and can be toggled through the "Wow! Signal" checkbox in the control panel or by pressing the <kbd>W</kbd> key. Hover or click the markers to see the horn name, observation date, precise RA/Dec in both sexagesimal and degrees, and a reminder about the dual-horn ambiguity. A debug handle is available at `window.__wow`, exposing `setVisible(boolean)` and `getVectors()` for quick inspection.

// Builds the site for Cloudflare: served from the root path, with the API on
// the same origin under /api. A script rather than inline environment variables
// so it runs the same from PowerShell, cmd and POSIX shells.
import { build } from 'vite';

process.env.SITE_BASE = '/';
process.env.VITE_API_BASE = '/api';

await build();

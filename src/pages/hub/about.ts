import '../../styles/about.css';

const base = import.meta.env.BASE_URL;

/** The eight explorers, in the order the home page lists them. */
const EXPLORERS: ReadonlyArray<{ key: string; name: string; href: string; source: string }> = [
  { key: 'neo3d', name: 'NEO 3D', href: `${base}neo3d.html`, source: 'NeoWs, JPL Horizons, SBDB' },
  { key: 'sat3d', name: 'Satellite 3D', href: `${base}sat3d.html`, source: 'TLE API' },
  { key: 'epic', name: 'EPIC Earth', href: '#/epic', source: 'DSCOVR EPIC' },
  { key: 'storm', name: 'Solar storms', href: `${base}storm.html`, source: 'DONKI' },
  { key: 'events', name: 'Earth events', href: `${base}events.html`, source: 'EONET' },
  { key: 'exo', name: 'Exoplanets', href: `${base}exo.html`, source: 'Exoplanet Archive' },
  { key: 'images', name: 'Mission images', href: '#/images/explorer', source: 'Image and Video Library' },
  { key: 'mars', name: 'Mars rovers', href: '#/mars', source: 'Image and Video Library' },
];

export function mountAboutPage(host: HTMLElement): void {
  // The page already has a <main>; this view is one article inside it.
  const container = document.createElement('article');
  container.className = 'about-page';
  const stamps = EXPLORERS.map(
    (item) => `
      <li>
        <a href="${item.href}">
          <img src="${base}art/icons/${item.key}.webp" alt="" width="512" height="512" loading="lazy" />
          <strong>${item.name}</strong>
          <span>${item.source}</span>
        </a>
      </li>`,
  ).join('');
  container.innerHTML = `
    <img class="about-page__art" src="${base}art/bg/hero.webp" alt="" width="1536" height="1024" />
    <header>
      <h1>About this project</h1>
      <p>
        NASA Open APIs Visualization Hub is a project by <strong>Ryan Hicks</strong>, built with AI coding assistants. It exists
        to show how much a plain web page can do with data that NASA and JPL give away.
      </p>
    </header>
    <section aria-labelledby="about-data-heading">
      <h2 id="about-data-heading">How the data flows</h2>
      <p>
        Every page fetches from NASA and JPL public services through one Cloudflare Worker. The Worker adds the NASA API key,
        allows only the routes this site uses, and caches keyless responses, so the browser never calls a third-party origin
        directly and no key ships in the page.
      </p>
      <ul class="about-page__stamps">${stamps}</ul>
    </section>
    <section aria-labelledby="about-build-heading">
      <h2 id="about-build-heading">How the site was built</h2>
      <p>
        The front end is Vite and TypeScript, with Three.js for the orbital scenes and Leaflet for the event map. It is a static
        site on GitHub Pages; the Worker is the only server involved. The illustrations were generated for this site in the
        manner of mid-century mission concept art.
      </p>
    </section>
    <footer class="about-page__footer" aria-labelledby="about-contact-heading">
      <h2 id="about-contact-heading">Say hello</h2>
      <p class="about-page__contact">Ryan Hicks, <a href="mailto:hicksrch@gmail.com">hicksrch@gmail.com</a></p>
      <p>Ideas, bug reports and collaborations are welcome.</p>
    </footer>
  `;

  host.replaceChildren(container);
}

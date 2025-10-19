import '../styles/about.css';

type Cleanup = () => void;

type RouteResult = void | Cleanup;

export function mountAboutPage(host: HTMLElement): RouteResult {
  const container = document.createElement('main');
  container.className = 'about-page';
  container.innerHTML = `
    <header>
      <h1>About This Project</h1>
      <p>
        NASA Open APIs Visualization Hub is a passion project by <strong>Ryan Hicks</strong>, crafted with help from OpenAI Codex
        to bring mission data to life in an accessible, cinematic interface.
      </p>
    </header>
    <section aria-labelledby="about-data-heading">
      <h2 id="about-data-heading">How the Data Flows</h2>
      <p>
        Every dataset you explore is fetched from NASA and JPL public services through a single Cloudflare Worker that fronts the
        external APIs. This worker injects the required NASA API key, enforces strict allowlists, and normalizes responses so the
        browser never has to call third-party origins directly.
      </p>
      <ul>
        <li><strong>NASA REST APIs</strong> — Astronomy Picture of the Day, EPIC, Mars Rover, NEO feed, and Images Explorer content.</li>
        <li><strong>JPL SBDB &amp; Horizons</strong> — Small-body orbital elements and planetary state vectors powering the 3D visualizer.</li>
        <li><strong>Edge caching</strong> — The worker caches successful keyless responses to keep the experience fast and reliable.</li>
      </ul>
    </section>
    <section aria-labelledby="about-build-heading">
      <h2 id="about-build-heading">How the Site Was Built</h2>
      <p>
        The frontend runs on Vite and TypeScript with Three.js rendering for orbital scenes, while shared utilities orchestrate
        routing, UI state, and NASA data processing. Codex accelerated prototyping, letting the project focus on storytelling and
        polish instead of boilerplate.
      </p>
      <p>
        The entire stack is open, with static assets deployed to GitHub Pages and the Worker acting as the secure gateway for data
        access.
      </p>
    </section>
    <footer class="about-page__footer" aria-labelledby="about-contact-heading">
      <h2 id="about-contact-heading">Say Hello</h2>
      <p class="about-page__contact">Ryan Hicks — <a href="mailto:hicksrch@gmail.com">hicksrch@gmail.com</a></p>
      <p>
        Have an idea, find a bug, or want to collaborate? Reach out anytime — feedback keeps the mission on course.
      </p>
    </footer>
  `;

  host.replaceChildren(container);

  return () => {
    if (host.contains(container)) {
      host.removeChild(container);
    }
  };
}

/* src/routes/epic.ts */
import { EpicViewer } from '../components/EpicViewer';
import '../styles/epic.css';

export function mountEpicPage(host: HTMLElement) {
  new EpicViewer(host);
}

export default function (host: HTMLElement) {
  mountEpicPage(host);
}

import { EpicViewer } from './EpicViewer';
import '../../styles/epic.css';

export function mountEpicPage(container: HTMLElement): () => void {
  const host = document.createElement('div');
  host.id = 'epic-host';
  container.replaceChildren(host);
  const viewer = new EpicViewer(host);
  return () => viewer.destroy();
}

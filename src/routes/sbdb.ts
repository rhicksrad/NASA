import { SbdbExplorer } from '../components/SbdbExplorer';
import '../styles/sbdb.css';

export default function mountSbdb(root: HTMLElement) {
  const host = document.createElement('div');
  root.replaceChildren(host);
  new SbdbExplorer(host);
}

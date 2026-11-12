/** Transient corner notifications. Styles live in components.css (`.toast-stack`). */

const VISIBLE_MS = 6000;
let stack: HTMLDivElement | null = null;

function show(message: string, modifier?: string): void {
  if (!stack?.isConnected) {
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.append(stack);
  }
  const item = document.createElement('div');
  item.className = modifier ? `toast-stack__item toast-stack__item--${modifier}` : 'toast-stack__item';
  item.textContent = message;
  stack.append(item);
  window.setTimeout(() => {
    item.remove();
    if (stack && !stack.childElementCount) {
      stack.remove();
      stack = null;
    }
  }, VISIBLE_MS);
}

export const toast = (message: string): void => show(message);
export const toastError = (message: string): void => show(message, 'error');

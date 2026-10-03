import { useEffect } from 'react';

/** Focus stays in the visible dialog. Escape invokes its existing close control. */
export function useDialogAccessibility(): void {
  useEffect(() => {
    let active: HTMLElement | null = null, sequence = 0;
    const returnFocus = new WeakMap<HTMLElement, HTMLElement | null>();
    const closeSelector = '[data-dialog-close], .drawer-head .icon-button, .modal-head .icon-button';
    const controls = (): HTMLElement[] => active ? Array.from(active.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(item => item.getClientRects().length > 0 && item.getAttribute('aria-hidden') !== 'true') : [];
    const update = (): void => {
      const visible = Array.from(document.querySelectorAll<HTMLElement>('.drawer, .modal, .v11-modal')).filter(item => item.getClientRects().length > 0);
      const next = visible.at(-1) ?? null;
      const leaving = active;
      const changed = next !== active;
      const restore = changed && leaving ? returnFocus.get(leaving) : null;
      if (changed && next && !returnFocus.has(next)) returnFocus.set(next, document.activeElement instanceof HTMLElement ? document.activeElement : null);
      active = next;
      if (next) {
        next.setAttribute('role', 'dialog'); next.setAttribute('aria-modal', 'true');
        next.tabIndex = -1;
        const heading = next.querySelector<HTMLElement>('h2, h3');
        if (heading) { heading.id ||= `workspace-dialog-title-${++sequence}`; next.setAttribute('aria-labelledby', heading.id); }
        const close = next.querySelector<HTMLButtonElement>(closeSelector);
        if (close && !close.getAttribute('aria-label')) close.setAttribute('aria-label', '关闭对话框');
        if (changed && restore?.isConnected && next.contains(restore)) restore.focus({ preventScroll: true });
        else if (changed || !next.contains(document.activeElement)) (close && !close.disabled ? close : controls()[0] ?? next).focus({ preventScroll: true });
      } else if (restore?.isConnected) restore.focus({ preventScroll: true });
    };
    const keydown = (event: KeyboardEvent): void => {
      if (!active || event.isComposing || event.defaultPrevented) return;
      if (event.key === 'Escape') {
        const close = active.querySelector<HTMLButtonElement>(closeSelector);
        if (close && !close.disabled) { event.preventDefault(); close.click(); }
      }
      if (event.key !== 'Tab') return;
      const items = controls(); if (!items.length) { event.preventDefault(); return; }
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (index < 0 || !event.shiftKey && index === items.length - 1 || event.shiftKey && index === 0) { event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0].focus(); }
    };
    const observer = new MutationObserver(update); observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', keydown); update();
    return () => { observer.disconnect(); document.removeEventListener('keydown', keydown); };
  }, []);
}

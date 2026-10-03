import { useEffect } from 'react';

/** Focus stays in the visible dialog. Escape invokes its existing close control. */
export function useDialogAccessibility(): void {
  useEffect(() => {
    let active: HTMLElement | null = null, previous: HTMLElement | null = null, sequence = 0;
    const controls = (): HTMLElement[] => active ? Array.from(active.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')).filter(item => item.getClientRects().length > 0 && item.getAttribute('aria-hidden') !== 'true') : [];
    const update = (): void => {
      const visible = Array.from(document.querySelectorAll<HTMLElement>('.drawer, .modal, .v11-modal')).filter(item => item.getClientRects().length > 0);
      const next = visible.at(-1) ?? null;
      if (next === active) return;
      if (active && !next && previous?.isConnected) previous.focus({ preventScroll: true });
      if (next) {
        if (!active) previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        next.setAttribute('role', 'dialog'); next.setAttribute('aria-modal', 'true');
        const heading = next.querySelector<HTMLElement>('h2, h3');
        if (heading) { heading.id ||= `workspace-dialog-title-${++sequence}`; next.setAttribute('aria-labelledby', heading.id); }
        active = next;
        const close = next.querySelector<HTMLElement>('.drawer-head .icon-button, .modal-head .icon-button');
        if (close && !close.getAttribute('aria-label')) close.setAttribute('aria-label', '关闭对话框');
        (close ?? controls()[0] ?? next).focus({ preventScroll: true });
      } else { active = null; previous = null; }
    };
    const keydown = (event: KeyboardEvent): void => {
      if (!active || event.isComposing || event.defaultPrevented) return;
      if (event.key === 'Escape') {
        const close = active.querySelector<HTMLButtonElement>('.drawer-head .icon-button, .modal-head .icon-button');
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

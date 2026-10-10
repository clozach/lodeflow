/** A top-layer escape from a cramped embed. It never moves the element or edits its document. */
export function fullscreenControl(host: HTMLElement, changed: () => void, announce: (text: string) => void) {
  let mode: 'closed' | 'native' | 'leaving-native' | 'popover' = 'closed';
  let pending = false;
  let connected = true;
  let nativeEscapeUntil = 0;
  const active = () => mode !== 'closed';
  const update = (next: typeof mode) => {
    if (mode === next) return;
    mode = next;
    changed();
  };
  const syncNative = () => {
    if (host.matches(':fullscreen')) { if (mode !== 'leaving-native') update('native'); }
    else if (mode === 'native' || mode === 'leaving-native') {
      // Some WebViews report native exit before forwarding its Escape key to the page.
      // Explicit button/shortcut exits do not arm this one-gesture guard.
      if (mode === 'native') nativeEscapeUntil = Date.now() + 500;
      update('closed');
    }
  };
  const exit = async () => {
    if (mode === 'native') {
      update('leaving-native');
      try { await host.ownerDocument.exitFullscreen(); }
      finally { update(host.matches(':fullscreen') ? 'native' : 'closed'); }
    }
    else if (mode === 'popover') {
      host.hidePopover();
      host.removeAttribute('popover');
      host.removeAttribute('data-lf-fullscreen');
      update('closed');
    }
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && Date.now() < nativeEscapeUntil) {
      nativeEscapeUntil = 0;
      event.preventDefault(); event.stopPropagation();
      return;
    }
    nativeEscapeUntil = 0;
    if (!active()) return;
    if (event.key === 'Escape') {
      // A browser may deliver Escape to the canvas as well as exiting its top layer.
      // Consume it before canvas deselection, an editor's finish, or a panel's close.
      event.preventDefault(); event.stopPropagation();
      void exit().catch(() => announce('Could not exit fullscreen. Please try again.'));
    } else if (mode === 'popover' && event.key === 'Tab') {
      // The fallback covers the page: keep keyboard users out of the obscured host controls.
      const root = host.shadowRoot;
      const controls = [...root?.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, [tabindex]') ?? []]
        .filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]'));
      const index = controls.indexOf(root?.activeElement as HTMLElement);
      if (controls.length && (index < 0 || (event.shiftKey ? index === 0 : index === controls.length - 1))) {
        event.preventDefault();
        controls[event.shiftKey ? controls.length - 1 : 0].focus({ preventScroll: true });
      }
    }
  };
  const onKeyUp = (event: KeyboardEvent) => { if (event.key === 'Escape') nativeEscapeUntil = 0; };
  const connect = () => {
    connected = true;
    host.ownerDocument.addEventListener('fullscreenchange', syncNative);
    host.ownerDocument.addEventListener('keydown', onKey, true);
    host.ownerDocument.addEventListener('keyup', onKeyUp, true);
  };
  const disconnect = () => {
    connected = false;
    if (mode === 'popover') void exit();
    host.ownerDocument.removeEventListener('fullscreenchange', syncNative);
    host.ownerDocument.removeEventListener('keydown', onKey, true);
    host.ownerDocument.removeEventListener('keyup', onKeyUp, true);
    mode = 'closed';
    nativeEscapeUntil = 0;
  };
  const toggle = async () => {
    if (pending) return;
    pending = true;
    try {
      if (active()) { await exit(); return; }
      // WKWebView and embedded pages may expose the method while denying fullscreen.
      if (host.ownerDocument.fullscreenEnabled && host.requestFullscreen) {
        try { await host.requestFullscreen(); syncNative(); return; } catch { /* try a page-sized top layer */ }
      }
      if (!connected) return;
      if (host.showPopover && !host.hasAttribute('popover')) {
        host.setAttribute('popover', 'manual');
        host.setAttribute('data-lf-fullscreen', '');
        try { host.showPopover(); update('popover'); }
        catch (error) { host.removeAttribute('popover'); host.removeAttribute('data-lf-fullscreen'); throw error; }
      } else announce('Fullscreen is unavailable in this browser.');
    } catch { announce('Could not change fullscreen. Please try again.'); }
    finally { pending = false; }
  };
  return { active, connect, disconnect, toggle };
}

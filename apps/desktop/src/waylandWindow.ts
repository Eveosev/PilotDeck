/** Ozone/Wayland session plus the BrowserWindow present path used after a hidden create. */

export type WaylandPresentableWindow = {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  isFocused(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  webContents: { invalidate?: () => void };
};

export function linuxOzonePlatform(env: NodeJS.ProcessEnv = process.env, argv: readonly string[] = process.argv): 'wayland' | 'x11' | null {
  if (env.PILOTDECK_CHROME_OZONE === 'x11' || argv.includes('--ozone-platform=x11')) return 'x11';
  if (env.PILOTDECK_CHROME_OZONE === 'wayland' || argv.includes('--ozone-platform=wayland')) return 'wayland';
  const named = argv.find(arg => arg.startsWith('--ozone-platform='));
  if (named === '--ozone-platform=x11') return 'x11';
  if (named === '--ozone-platform=wayland') return 'wayland';
  return null;
}

/** X11 ozone must win even if WAYLAND_DISPLAY leaked into the environment. */
export function isLinuxWaylandSession(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): boolean {
  if (platform !== 'linux') return false;
  const ozone = linuxOzonePlatform(env, argv);
  if (ozone === 'x11') return false;
  if (ozone === 'wayland') return true;
  return Boolean(env.WAYLAND_DISPLAY);
}

/**
 * Hung File-click rounds probe isVisible/isFocused/isPainting=false while the
 * DOM still reports visible, and rAF is already 0 before the caption click.
 * First-show used to call show() only; restore already did show()+focus().
 * After the window is mapped, invalidate() asks Ozone for a compositor frame.
 */
export function presentLinuxWaylandWindow(window: WaylandPresentableWindow): boolean {
  if (window.isDestroyed()) return false;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  window.webContents.invalidate?.();
  return window.isVisible();
}

/** Ozone xdg_toplevel.configure is async; a second present after the tick remaps a silent first show(). */
export function scheduleLinuxWaylandPresent(
  window: WaylandPresentableWindow,
  later: (fn: () => void) => void = setImmediate,
): void {
  presentLinuxWaylandWindow(window);
  later(() => {
    if (window.isDestroyed()) return;
    if (window.isVisible() && window.isFocused()) {
      window.webContents.invalidate?.();
      return;
    }
    presentLinuxWaylandWindow(window);
  });
}

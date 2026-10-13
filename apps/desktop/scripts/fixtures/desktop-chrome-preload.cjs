// Fixture-only preload wrapper. Product preload is unchanged.
require('../../dist/preload.js');
if (process.env.PILOTDECK_WAYLAND_DIAG === '1') {
  const { webFrame } = require('electron');
  const { installWaylandDiag } = require('./wayland-file-diag.cjs');
  webFrame.executeJavaScript(`(${installWaylandDiag.toString()})('preload')`).catch(() => {});
}

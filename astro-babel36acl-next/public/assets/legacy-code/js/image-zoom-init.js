(function () {
  'use strict';
  // medium-zoom installs document listeners per instance; retain one runtime.
  const zoom = window.mediumZoom([], {
    margin: 24, background: 'rgba(10, 12, 18, 0.86)', scrollOffset: 40
  });
  let leaving = false;
  zoom.on('open', () => { leaving = false; });
  zoom.on('opened', () => {
    // close() is ignored while opening. Finish closing if navigation raced it.
    if (leaving) zoom.close();
  });
  window.BAC_Lifecycle.register('zoom', ({ root, cleanup }) => {
    const images = Array.from(root.querySelectorAll('img'));
    zoom.attach(...images);
    cleanup(() => {
      if (images.includes(zoom.getZoomedImage())) leaving = true;
      zoom.detach(...images);
    });
  });
})();

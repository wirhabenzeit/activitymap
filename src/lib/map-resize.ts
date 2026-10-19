/** Observe the actual map viewport, including sidebar animation and hidden
 * retained routes. Coalesce geometry notifications and release all work. */
export function observeMapResize(map: {
  getContainer(): HTMLElement;
  resize(): unknown;
}) {
  const container = map.getContainer();
  let frame = 0;
  let lastWidth = -1;
  let lastHeight = -1;
  const measure = () => {
    frame = 0;
    const { width, height } = container.getBoundingClientRect();
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    if (width > 0 && height > 0) map.resize();
  };
  const observer = new ResizeObserver(() => {
    if (!frame) frame = requestAnimationFrame(measure);
  });
  observer.observe(container);
  measure();
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}

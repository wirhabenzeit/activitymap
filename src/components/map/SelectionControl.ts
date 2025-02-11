'use client';

import { type MapMouseEvent, Point, type PointLike } from 'mapbox-gl';
import { useControl } from 'react-map-gl/mapbox';
import { useShallowStore } from '~/store';

const styles = `
.boxdraw {
    background: rgba(56, 135, 190, 0.1);
    border: 2px solid #3887be;
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
}
`;

export function Selection() {
  const [setSelected, selected] = useShallowStore((state) => [
    state.setSelected,
    state.selected,
  ]);

  useControl(
    (context: MapContextValue) =>
      new SelectionControl({
        context,
        layers: ['routeLayerBG', 'routeLayerBGsel'],
        source: 'routeSource',
        selectionHandler: (sel: number[]) => {
          const ids = Array.from(new Set(sel));
          setSelected(ids);
        },
      }),
  );
  return null;
}

export class SelectionControl {
  layers: string[];
  source: string;
  selectionHandler: (ids: number[]) => void;
  context: MapContextValue;
  canvas?: HTMLElement;
  map?: mapboxgl.Map;
  start?: Point;
  current?: Point;
  box?: HTMLDivElement;
  rect?: DOMRect;
  _container: HTMLElement;

  constructor({
    layers,
    source,
    selectionHandler,
    context,
  }: {
    layers: string[];
    source: string;
    selectionHandler: (ids: number[]) => void;
    context: MapContextValue;
  }) {
    const styleSheet = document.createElement('style');
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    this.layers = layers;
    this.source = source;
    this.selectionHandler = selectionHandler;
    this.context = context;
    this._container = document.createElement('div');
  }

  onChange() {
    return;
  }

  mousePos = (e: MapMouseEvent) => {
    if (!this.rect || !this.canvas) return new Point(0, 0);
    return new Point(
      e.originalEvent.clientX - this.rect.left - this.canvas.clientLeft,
      e.originalEvent.clientY - this.rect.top - this.canvas.clientTop,
    );
  };

  click = (e: MapMouseEvent) => {
    if (!this.map) return;

    const bbox: [PointLike, PointLike] = [
      [e.point.x - 5, e.point.y - 5],
      [e.point.x + 5, e.point.y + 5],
    ];
    const selectedFeatures = this.map.queryRenderedFeatures(bbox, {
      layers: this.layers,
    });
    this.selectionHandler(
      selectedFeatures.map((feature) => feature.id as number),
    );
  };

  onAdd(map: mapboxgl.Map) {
    this.map = map;
    this.canvas = map.getCanvasContainer();
    this.rect = this.canvas.getBoundingClientRect();

    map.on('mousedown', this.mouseDown);
    map.on('click', this.click);

    return this._container;
  }

  mouseDown = (e: MapMouseEvent) => {
    if (!(e.originalEvent.shiftKey && e.originalEvent.button === 0)) return;

    this.map?.dragPan.disable();
    this.map?.on('mousemove', this.onMouseMove);
    this.map?.on('mouseup', this.onMouseUp);
    this.start = this.mousePos(e);
  };

  onMouseMove = (e: MapMouseEvent) => {
    this.current = this.mousePos(e);

    if (!this.box) {
      this.box = document.createElement('div');
      this.box.classList.add('boxdraw');
      this.canvas?.appendChild(this.box);
    }

    const minX = Math.min(this.start!.x, this.current.x),
      maxX = Math.max(this.start!.x, this.current.x),
      minY = Math.min(this.start!.y, this.current.y),
      maxY = Math.max(this.start!.y, this.current.y);

    const pos = `translate(${minX}px, ${minY}px)`;
    this.box.style.transform = pos;
    this.box.style.width = maxX - minX + 'px';
    this.box.style.height = maxY - minY + 'px';
  };

  onMouseUp = (e: MapMouseEvent) => {
    this.finish([this.start!, this.mousePos(e)]);
  };

  finish = (bbox: [PointLike, PointLike]) => {
    // Remove these events now that finish has been called.
    this.map?.off('mousemove', this.onMouseMove);
    this.map?.off('mouseup', this.onMouseUp);

    if (this.box?.parentNode) {
      this.box.parentNode.removeChild(this.box);
      this.box = undefined;
    }

    // If bbox exists. use this value as the argument for `queryRenderedFeatures`
    if (bbox) {
      const selectedFeatures = this.map?.queryRenderedFeatures(bbox, {
        layers: this.layers,
      });
      if (selectedFeatures)
        this.selectionHandler(
          selectedFeatures.map((feature) => feature.id as number),
        );
    }
    this.map?.dragPan.enable();
  };

  onRemove(map: mapboxgl.Map) {
    map.off('mousedown', this.mouseDown);
    map.off('click', this.click);
    this._container.parentNode?.removeChild(this._container);
  }
}

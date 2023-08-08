import { Point } from "mapbox-gl";

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

export class SelectionControl {
  constructor(props) {
    const styleSheet = document.createElement("style");
    styleSheet.innerText = styles;
    document.head.appendChild(styleSheet);

    this.mapRef = props.mapRef;
    this._map;
    this.canvas;
    this.layers = props.layers;
    this.source = props.source;
    this.selectionHandler = props.selectionHandler;
    this.start;
    this.current;
    this.box = null;
  }

  onChange() {
    return;
  }

  onAdd(map) {
    console.log(this.mapRef.current.getMap());
    console.log(map);
    this._map = map;
    //this.canvas = map.getCanvasContainer();
    this.canvas = this.mapRef.current.getCanvasContainer();
    this._container = document.createElement("div");

    map.on("click", (e) => {
      const bbox = [
        [e.point.x - 5, e.point.y - 5],
        [e.point.x + 5, e.point.y + 5],
      ];
      const selectedFeatures = map.queryRenderedFeatures(bbox, {
        layers: this.layers,
      });
      this.selectionHandler(selectedFeatures.map((feature) => feature.id));
    });

    this.canvas.addEventListener("mousedown", this.mouseDown, true);
    return this._container;
  }

  mousePos = (e) => {
    const rect = this.canvas.getBoundingClientRect();
    return new Point(
      e.clientX - rect.left - this.canvas.clientLeft,
      e.clientY - rect.top - this.canvas.clientTop
    );
  };

  mouseDown = (e) => {
    if (!(e.shiftKey && e.button === 0)) return;

    this.mapRef.current.getMap().dragPan.disable();

    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("keydown", this.onKeyDown);

    this.start = this.mousePos(e);
  };

  onMouseMove = (e) => {
    this.current = this.mousePos(e);

    if (!this.box) {
      this.box = document.createElement("div");
      this.box.classList.add("boxdraw");
      this.canvas.appendChild(this.box);
    }

    const minX = Math.min(this.start.x, this.current.x),
      maxX = Math.max(this.start.x, this.current.x),
      minY = Math.min(this.start.y, this.current.y),
      maxY = Math.max(this.start.y, this.current.y);

    // Adjust width and xy position of the box element ongoing
    const pos = `translate(${minX}px, ${minY}px)`;
    this.box.style.transform = pos;
    this.box.style.width = maxX - minX + "px";
    this.box.style.height = maxY - minY + "px";
  };

  onMouseUp = (e) => {
    this.finish([this.start, this.mousePos(e)]);
  };

  onKeyDown = (e) => {
    if (e.keyCode === 27) finish();
  };

  finish = (bbox) => {
    // Remove these events now that finish has been called.
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("mouseup", this.onMouseUp);

    if (this.box) {
      this.box.parentNode.removeChild(this.box);
      this.box = null;
    }

    // If bbox exists. use this value as the argument for `queryRenderedFeatures`
    if (bbox) {
      const selectedFeatures = this.mapRef.current.queryRenderedFeatures(bbox, {
        layers: this.layers,
      });
      this.selectionHandler(selectedFeatures.map((feature) => feature.id));
    }
    this.mapRef.current.getMap().dragPan.enable();
  };

  onRemove() {
    this._container.parentNode.removeChild(this._container);
    this._map = undefined;
  }
}

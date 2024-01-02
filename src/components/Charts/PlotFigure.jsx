import * as Plot from "@observablehq/plot";
import { useEffect, useRef } from "react";

// For server-side rendering, see https://codesandbox.io/s/plot-react-f1jetw?file=/src/PlotFigure.js:89-195

export default function PlotFigure({ options }) {
  const containerRef = useRef();

  useEffect(() => {
    if (options == null) return;
    const plot = Plot.plot(options);
    containerRef.current.append(plot);
    return () => plot.remove();
  }, [options]);

  return <div ref={containerRef} />;
}

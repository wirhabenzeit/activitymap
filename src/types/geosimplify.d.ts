declare module '@mapbox/geosimplify-js' {
  export default function geosimplify(
    coords: number[][],
    tolerance: number,
    highQuality?: number,
  ): number[][];
}

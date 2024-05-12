import statsPlots from "~/stats";

//export const dynamicParams = false;

import Plot from "~/components/Plot";

/*export function generateStaticParams() {
  return Object.keys(statsPlots);
}*/

export default async function Page({
  params,
}: {
  params: {name: string};
}) {
  return <Plot name={params.name} />;
}

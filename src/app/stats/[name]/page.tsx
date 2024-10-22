import statsPlots from "~/stats";
import {notFound} from "next/navigation";

import Plot from "~/components/Plot";

export default async function Page(
  props: {
    params: Promise<{name: string}>;
  }
) {
  const params = await props.params;
  if (Object.keys(statsPlots).includes(params.name)) {
    return (
      <Plot name={params.name as keyof typeof statsPlots} />
    );
  }
  return notFound();
}

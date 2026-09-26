import { chartPlots } from '~/components/stats';
import { notFound } from 'next/navigation';

import Plot from '~/components/stats/plot';
import CalendarHeatmap from '~/components/stats/calendar-heatmap';
import StatsTiles from '~/components/stats/tiles';

export default async function Page(props: {
  params: Promise<{ name: string }>;
}) {
  const params = await props.params;
  if (params.name === 'tiles') {
    return <StatsTiles />;
  }
  if (params.name === 'calendar') {
    return <CalendarHeatmap />;
  }
  if (Object.keys(chartPlots).includes(params.name)) {
    return <Plot name={params.name as keyof typeof chartPlots} />;
  }
  return notFound();
}

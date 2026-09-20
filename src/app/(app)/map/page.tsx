'use client';

import dynamic from 'next/dynamic';
import React from 'react';

const InteractiveMap = dynamic(
  () => import('~/components/map/interactive-map'),
  {
    ssr: false,
    loading: () => <div className="h-full w-full bg-muted/20 animate-pulse" />,
  },
);

export default function MapPage() {
  return <InteractiveMap />;
}

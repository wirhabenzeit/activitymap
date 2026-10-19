import GeoJsonToGpx from '@dwayneparton/geojson-to-gpx';
import type { Feature, GeoJsonProperties, Geometry } from 'geojson';
import { Download } from 'lucide-react';
import Image from 'next/image';
import React from 'react';
import Markdown from 'react-markdown';

import { DismissButton } from '~/components/dismiss-button';
import { Button } from '~/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '~/components/ui/card';

interface FeatureInfoCardProps {
  feature: Feature<Geometry, GeoJsonProperties> | null;
  onClose: () => void;
}

export const FeatureInfoCard: React.FC<FeatureInfoCardProps> = ({
  feature,
  onClose,
}) => {
  if (!feature) return null;
  const properties = feature.properties ?? {};
  const propertyMap = properties as Record<string, unknown>;
  const getStringProperty = (key: string): string | undefined => {
    const value = propertyMap[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  };

  const candidateTitle =
    getStringProperty('Name') ??
    getStringProperty('RUTE') ??
    getStringProperty('FJELL') ??
    getStringProperty('OMRÅDE') ??
    getStringProperty('name');
  const fallbackId =
    getStringProperty('TUR_NR') ??
    getStringProperty('TURNUMMER') ??
    getStringProperty('TURNR') ??
    getStringProperty('ID');
  const fallbackTitle = [propertyMap.source, fallbackId]
    .filter((value) => value !== undefined && value !== null && value !== '')
    .join(' # ');
  const title =
    getStringProperty('full_title') ??
    getStringProperty('title') ??
    candidateTitle ??
    fallbackTitle ??
    'Feature Info';
  const description =
    getStringProperty('short_title_en') ??
    getStringProperty('short_title') ??
    getStringProperty('description');
  const imageUrl = getStringProperty('image_url');
  const originalUrl = getStringProperty('original_url');
  const externalGpxUrl = getStringProperty('gpx_url');
  const displayTitle = getStringProperty('title');

  const hiddenKeys = new Set([
    'title',
    'full_title',
    'short_title',
    'short_title_en',
    'name',
    'description',
    'image_url',
    'canonical',
    'original_url',
    'gpx_url',
  ]);
  const metadataEntries = Object.entries(properties).filter(
    ([key, value]) =>
      !hiddenKeys.has(key) &&
      value !== undefined &&
      value !== null &&
      value !== '',
  );
  const hasGeometry = !!feature.geometry;
  const hasExternalGpxUrl = !!externalGpxUrl;

  const downloadGpxFromGeometry = () => {
    if (!feature.geometry) return;

    const metadata: { name: string; desc?: string } = { name: String(title) };
    if (description) metadata.desc = description;

    const gpx = GeoJsonToGpx(feature, { metadata });
    const gpxString = new XMLSerializer().serializeToString(gpx);
    const blob = new Blob([gpxString], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName =
      String(title)
        .replace(/[^\w.-]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'feature';
    a.href = url;
    a.download = `${safeName}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleGpxClick = () => {
    if (hasGeometry) {
      downloadGpxFromGeometry();
      return;
    }
    if (hasExternalGpxUrl) {
      window.open(externalGpxUrl, '_blank');
    }
  };

  return (
    <Card className="absolute right-4 bottom-4 z-10 flex h-[50dvh] w-[min(500px,80dvw)] flex-col bg-white/90 backdrop-blur-sm">
      <div className="flex-grow overflow-auto">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">{title}</CardTitle>
            <DismissButton
              label="Close map feature details"
              onClick={onClose}
            />
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          {imageUrl && (
            <div className="mb-3 h-60 overflow-hidden rounded-md">
              <Image
                src={imageUrl}
                alt={displayTitle ?? 'Feature image'}
                width={1200}
                height={600}
                unoptimized
                className="h-full w-full object-cover"
              />
            </div>
          )}
          {description && (
            <div className="rounded bg-gray-50/50 p-1 text-sm text-gray-700">
              <Markdown
                components={{
                  h1: ({ children }) => (
                    <h1 className="mb-2 text-lg font-bold">{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="mb-1.5 text-base font-semibold">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="mb-1 text-sm font-medium">{children}</h3>
                  ),
                  p: ({ children }) => <p className="mb-2">{children}</p>,
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      className="text-blue-600 hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {children}
                    </a>
                  ),
                  ul: ({ children }) => (
                    <ul className="mb-2 list-disc pl-5">{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="mb-2 list-decimal pl-5">{children}</ol>
                  ),
                  li: ({ children }) => <li className="mb-1">{children}</li>,
                }}
              >
                {description}
              </Markdown>
            </div>
          )}
          {metadataEntries.length > 0 && (
            <div className="mt-3 space-y-1 rounded bg-gray-50/50 p-2 text-xs text-gray-700">
              {metadataEntries.map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <span className="w-32 shrink-0 font-semibold">{key}</span>
                  <span className="break-all">{String(value)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </div>
      <CardFooter className="flex flex-shrink-0 gap-2 pt-0">
        {originalUrl && (
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => window.open(originalUrl, '_blank')}
          >
            View Details
          </Button>
        )}
        {(hasGeometry || hasExternalGpxUrl) && (
          <Button
            variant="outline"
            size="sm"
            className={originalUrl ? 'w-auto' : 'flex-1'}
            onClick={handleGpxClick}
          >
            <Download className="mr-2 h-4 w-4" />
            GPX
          </Button>
        )}
      </CardFooter>
    </Card>
  );
};

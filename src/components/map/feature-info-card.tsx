import React from 'react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from '~/components/ui/card';
import { Button } from '~/components/ui/button';
import type { GeoJsonProperties } from 'geojson';
import { X, Download } from 'lucide-react';
import Markdown from 'react-markdown';

interface FeatureInfoCardProps {
  feature: GeoJsonProperties | null;
  onClose: () => void;
}

export const FeatureInfoCard: React.FC<FeatureInfoCardProps> = ({
  feature,
  onClose,
}) => {
  if (!feature) return null;

  return (
    <Card className="bg-white/90 backdrop-blur-sm absolute bottom-4 right-4 z-10 w-[min(500px,80dvw)] h-[50dvh] flex flex-col">
      <div className="overflow-auto flex-grow">
        <CardHeader className="pb-2">
          <div className="flex justify-between items-center">
            <CardTitle className="text-lg">
              {feature.title ?? 'Feature Info'}
            </CardTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 -mr-2"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pb-4">
          {feature.image_url && (
            <div className="mb-3 overflow-hidden rounded-md h-60">
              <img
                src={feature.image_url as string}
                alt={(feature.title as string) ?? 'Feature image'}
                className="h-full w-full object-cover"
              />
            </div>
          )}
          {feature.description && (
            <div className="text-sm text-gray-700 p-1 rounded bg-gray-50/50">
              <Markdown
                components={{
                  h1: ({ children }) => (
                    <h1 className="text-lg font-bold mb-2">{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-base font-semibold mb-1.5">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-sm font-medium mb-1">{children}</h3>
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
                    <ul className="list-disc pl-5 mb-2">{children}</ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal pl-5 mb-2">{children}</ol>
                  ),
                  li: ({ children }) => <li className="mb-1">{children}</li>,
                }}
              >
                {feature.description as string}
              </Markdown>
            </div>
          )}
        </CardContent>
      </div>
      <CardFooter className="pt-0 flex-shrink-0 flex gap-2">
        {feature.original_url && (
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() =>
              window.open(feature.original_url as string, '_blank')
            }
          >
            View Details
          </Button>
        )}
        {feature.gpx_url && (
          <Button
            variant="outline"
            size="sm"
            className={feature.original_url ? 'w-auto' : 'flex-1'}
            onClick={() => window.open(feature.gpx_url as string, '_blank')}
          >
            <Download className="h-4 w-4 mr-2" />
            GPX
          </Button>
        )}
      </CardFooter>
    </Card>
  );
};

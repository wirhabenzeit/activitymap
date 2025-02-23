import { useState } from 'react';
import { type Photo } from '~/server/db/schema';
import { Button } from '~/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '~/components/ui/dialog';
import {
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '~/components/ui/carousel';
import { cn } from '~/lib/utils';
import Image from 'next/image';

interface PhotoLightboxProps {
  photos: Photo[];
  title: string;
  className?: string;
}

export function PhotoLightbox({
  photos,
  title,
  className,
}: PhotoLightboxProps) {
  const [open, setOpen] = useState(false);
  const [api, setApi] = useState<CarouselApi>();
  const [currentIndex, setCurrentIndex] = useState(0);

  return (
    <>
      <div
        className={cn(
          'flex flex-row items-center gap-2 h-[1.5rem] overflow-x-scroll',
          className,
        )}
      >
        {photos?.map((photo, index) => (
          <Button
            key={photo.unique_id}
            variant="ghost"
            size="icon"
            className="p-0 h-full rounded-sm aspect-square object-cover w-auto"
          >
            <Image
              src={photo.urls ? Object.values(photo.urls)[0] : ''}
              width={Object.values(photo.sizes)[0][0]}
              height={Object.values(photo.sizes)[0][1]}
              alt={photo.caption ?? ''}
              className="h-full rounded-sm aspect-square object-cover"
              onClick={() => {
                api?.scrollTo(index);
                setOpen(true);
              }}
            />
          </Button>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen} modal={false}>
        <DialogContent
          className="p-0 bg-background/80 w-screen h-screen overflow-hidden max-w-none max-h-none border-0 rounded-none focus:outline-none"
          onClick={() => setOpen(false)}
        >
          <DialogTitle className="hidden">{title}</DialogTitle>
          <Carousel className="relative" setApi={(api) => setApi(api)}>
            <CarouselContent className="h-full absolute inset-0 ml-0">
              {photos.map((photo, index) => (
                <CarouselItem
                  key={photo.unique_id}
                  className="flex items-center justify-center pl-0"
                >
                  <Image
                    src={photo.urls ? Object.values(photo.urls).at(-1) : ''}
                    width={Object.values(photo.sizes).at(-1)?.[0] ?? 0}
                    height={Object.values(photo.sizes).at(-1)?.[1] ?? 0}
                    alt={photo.caption ?? ''}
                    className="max-w-[calc(100vw-4rem)] max-h-[calc(100vh-4rem)] object-contain rounded-lg border-2 border-background"
                    onClick={(e) => e.stopPropagation()}
                  />
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious
              className="absolute left-4"
              onClick={(e) => {
                e.stopPropagation();
                api?.scrollPrev();
              }}
            />
            <CarouselNext
              className="absolute right-4"
              onClick={(e) => {
                e.stopPropagation();
                api?.scrollNext();
              }}
            />
          </Carousel>
        </DialogContent>
      </Dialog>
    </>
  );
}

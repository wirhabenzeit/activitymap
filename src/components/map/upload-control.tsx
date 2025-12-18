'use client';

import { Button } from '../ui/button';
import { Upload } from 'lucide-react';
import { useShallowStore } from '~/store';
import { useRef } from 'react';
import toGeoJSON from '@mapbox/togeojson';

export function UploadControl() {
    const { setUploadedGeoJson } = useShallowStore((state) => ({
        setUploadedGeoJson: state.setUploadedGeoJson,
    }));
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target?.result;
            if (typeof text === 'string') {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(text, 'text/xml');
                // @ts-ignore
                const geoJson = toGeoJSON.gpx(xmlDoc);
                setUploadedGeoJson(geoJson);
            }
        };
        reader.readAsText(file);
    };

    return (
        <div className="z-1 h-[29px] w-[29px] rounded-md bg-white">
            <Button
                onClick={() => fileInputRef.current?.click()}
                className="[&_svg]:size-5"
            >
                <Upload className="mx-auto" color="black" />
            </Button>
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".gpx"
                className="hidden"
            />
        </div>
    );
}

# Map photos

Native and web share the screen-space policy in `shared/parity/map-photos.v1.json`:

- Below zoom 12: 44-point camera pins; nearby photos have a count badge. No thumbnail requests.
- At zoom 12 and above: 52-point thumbnails, with a count badge for nearby or coincident photos.
- At most 80 markers in the viewport plus a 44-point edge margin. Dense views are regrouped, preserving all photo counts.
- Group anchors are real photo coordinates. Settled camera movement and resize refresh grouping; markers follow the map during movement.
- Eligibility follows the browsing projection, including ordinary filters and Only selected. Locationless photos remain available in activity galleries; zero latitude/longitude are valid.

A grouped pin zooms in. A single pin or thumbnail opens the existing viewer directly at the tapped photo. A stack browses the photos in that group, including photos from different activities. A single-photo marker opens its activity's full gallery. Viewing photos preserves selection and camera; the explicit **View activity** action inspects the current photo's activity in List. On iPhone the results sheet presents the viewer while it is visible, retaining its detent when the viewer closes.

Native visibility is the first action in **Layers → Activity photos → Show photos on map**, initially off. An enabled layer with no located photos explains that state in the menu. Web retains its photo control with an explicit pressed state. Visibility does not fit the map or change selection. Native account reset disables the layer; web media state remounts on account/guest scope changes. Deletion and filters remove obsolete markers and dismiss an ineligible current photo.

## Ordinary device review

1. On a map with activity photos, turn the layer on. Zoom out: camera pins and counts should appear without a grid of images. Tap a counted pin to zoom in.
2. Zoom in: small thumbnails should appear. Tap one, including a stack directly over a route. The viewer opens at the tapped photo and selected routes stay unchanged.
3. Browse a stack across different activities; the heading and **View activity** action follow the current photo. Close the viewer: the map and results panel retain their context.
4. Use **View activity**: List inspects the current activity while retaining the selected group. Return to Map.
5. Apply a sport/date filter, then Only selected. Photo eligibility follows those controls. Turn photos off/on: no camera move or selection change.
6. Repeat with the iPhone portrait sheet and landscape panel, and the iPad native/web map. Check thumbnails near controls and map edges.
7. If available, check missing/broken images and photos without GPS in the ordinary activity gallery.

VoiceOver, Dynamic Type and the dedicated accessibility acceptance pass are tracked separately in #387. Cache/network/deletion/account engineering acceptance remains #227; large-library device measurements remain #229.

## Automated checks

```sh
node --import tsx --test src/lib/map-photos.test.ts src/lib/photo-gallery.test.ts
node scripts/verify-map-photos.mjs /tmp/activitymap-map-photos
node scripts/verify-photo-viewer.mjs /tmp/activitymap-photo-viewer
```

`MapPhotoTests` consumes the shared policy/layout fixture, validates zero/invalid coordinates and checks 10,000 photos remain represented within the marker budget. `RenderedMapPhotoTests` runs the production native map, activating pins/thumbnails and exercising full-screen presentation with and without a results panel, filtering, deletion and explicit activity navigation. `PhotoGalleryTests` preserves existing gallery/cache regressions. These automated checks do not substitute for owner device acceptance.

# Map photos

Native and web share the screen-space policy in `shared/parity/map-photos.v1.json`:

- Below zoom 12: 28-point camera pins with 44-point tap targets; nearby photos have a count badge. No thumbnail requests.
- At zoom 12 and above: 36-point thumbnails with 44-point tap targets, with a count badge for nearby or coincident photos.
- At most 80 markers in the viewport plus a 44-point edge margin. Dense views are regrouped, preserving all photo counts.
- Group anchors are real photo coordinates. Settled camera movement and resize refresh grouping; markers follow the map during movement.
- Eligibility follows the browsing projection, including ordinary filters and Only selected. Locationless photos remain available in activity galleries; zero latitude/longitude are valid.

A grouped pin zooms in. A single pin or thumbnail opens the existing viewer directly at the tapped photo. Native opens the tapped photo in the same activity gallery used from activity details, including locationless photos. Horizontal swipes stay within that activity. A stack containing different activities offers those activities in the viewer title menu; choosing one switches to its full gallery. Map and activity entries share the native zoom transition and interactive swipe dismissal. Web stacks retain their group gallery. Viewing photos preserves selection and camera; the explicit **View activity** action inspects the current photo's activity in List. On iPhone the results sheet presents the viewer while it is visible, retaining its detent when the viewer closes.

Native and web visibility is the first action in **Layers → Activity photos → Show photos on map**, initially off. Native explains an enabled layer with no located photos in the menu. Web also retains its camera control, sharing the same state as the layer-menu checkbox. The shared web lightbox slides photos in the navigation direction for buttons, arrow keys and touch swipes; reduced motion switches immediately. Visibility does not fit the map or change selection. Native account reset disables the layer; web media state remounts on account/guest scope changes. Deletion and filters remove obsolete markers and dismiss an ineligible current photo, including slides being animated out.

## Ordinary device review

1. On a map with activity photos, turn the layer on. Zoom out: camera pins and counts should appear without a grid of images. Tap a counted pin to zoom in.
2. Zoom in: small thumbnails should appear. Tap one, including a stack directly over a route. The viewer opens at the tapped photo and selected routes stay unchanged.
3. On native, swipe through photos from the tapped activity, including photos without GPS. For a stack spanning activities, choose another activity from the title menu, then page within that gallery. Swipe down to dismiss: the map and results panel retain their context. Repeat swipe dismissal from an activity gallery. Web stacks retain their group gallery.
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

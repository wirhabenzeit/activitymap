# ActivityMap app icon

The source of truth is [`AppIcon.icon`](../ios/ActivityMap/ActivityMap/AppIcon.icon).
Open it in Icon Composer to edit the layered design. The background uses the
automatic gradient based on app blue (`#1976D2`); the route uses the same solid
blue. The map panels have solid fills, with glass shading disabled.

The Xcode target includes the package through its synchronized `ActivityMap`
folder. `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon` in `Base.xcconfig` selects
it in both build configurations. Keep the package name and this setting aligned.

## Regenerate web assets

On macOS with Xcode 27 selected, Python 3, ImageMagick (`magick`), and librsvg
(`rsvg-convert`) available:

```sh
pnpm icons:generate
```

The generator reads the package directly; there is no second copy of the map
or route artwork to maintain. It exports:

- `public/app-icon.png`: the native default rendition, converted from Display P3
  to sRGB before its metadata is stripped. The regular install PNGs and ICO use
  this rendering, including the native enclosure lighting.
- `public/favicon.svg`: vector panels and route, plus a static gradient sampled
  from Icon Composer's background-only rendering. Apple's dynamic enclosure
  lighting is omitted in this vector version.
- `public/app-mark.svg`: the same vector panels and route with no background
  rect or gradient, for coloured surfaces such as the web header. Its viewBox
  is cropped to the panels so the mark fills small boxes. The route is
  drawn over the white map panels, so it stays legible on any header colour and
  needs no outline.
- Apple touch PNG/SVG and maskable PNGs: opaque, full-bleed backgrounds so the
  operating system can apply its own mask. Maskable artwork is slightly inset
  to keep the map inside the central safe area.
- Safari's monochrome pinned-tab silhouette, existing Windows tile sizes, and
  all existing iOS web launch-image sizes.

The root Next.js metadata prefers the SVG favicon and keeps the ICO fallback.
The navigation uses `app-mark.svg`, while tabs and install surfaces keep the
tile; the web manifest distinguishes regular and maskable install icons. The service-worker cache version is bumped when these
assets change so existing installations fetch the new identity.

## Verify a change

Inspect the native PNG, vector favicon, 16px ICO frame, pinned-tab silhouette,
maskable icon, and portrait/landscape launch images. Re-run the generator and
check that the resulting files are stable. Run TypeScript and lint checks, then
build the iOS target and confirm the built `Info.plist` names `AppIcon`.

Apple's integration reference: [Creating your app icon using Icon Composer](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer).

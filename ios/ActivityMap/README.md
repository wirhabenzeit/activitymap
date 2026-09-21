# ActivityMap iOS mockup

This is the SwiftUI prototype for a future native ActivityMap client. It currently uses sample data and is not connected to the v1 API or sync engine.

## Run it

1. Use Xcode 27 or newer.
2. Copy `Config/Local.xcconfig.example` to `Config/Local.xcconfig`.
3. Add a URL-restricted public Mapbox token to the local file.
4. Open `ActivityMap.xcodeproj` and run the `ActivityMap` scheme.

Swift Package Manager pins the Mapbox dependency in `Package.resolved`. Local Xcode state and credentials are intentionally ignored.

The bundle identifier, signing team, production authentication, legal links, and App Store metadata remain intentionally unset while this is a mockup.

## Shared configuration direction

Portable map sources live in the validated `shared/map-catalog.json` catalogue. The web client reads it directly, while `pnpm map-catalog:generate` produces the committed Swift representation.

Each client composes those sources with platform-native additions. The React-based Friflyt GeoJSON layer therefore stays in the web adapter, and Mapbox Standard stays native to iOS. UI implementation, icons, gestures, and locale-aware date, duration, measurement, and number formatting remain native. API payloads remain defined by OpenAPI.

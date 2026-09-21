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

Cross-client product data should live in a language-neutral, validated catalog. Map source IDs, URLs, source types, attribution, ordering, defaults, opacity, and capability flags are good candidates. TypeScript and Swift should each adapt that catalog to their native map SDK.

UI implementation, icons, gestures, and locale-aware date, duration, measurement, and number formatting should remain native to each client. API payloads remain defined by OpenAPI.

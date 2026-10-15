import CoreLocation
import Foundation
import Testing
@testable import ActivityMap

@MainActor
struct ActivityActionTests {
    @Test(arguments: [ActivityMapAPI.StreamSeriesType.distance, .time])
    func gpxIncludesSampledElevationAtItsOwnGPSCoordinates(basis: ActivityMapAPI.StreamSeriesType) throws {
        let activity = try StoredModelMapper.activity(Fixtures.activity())
        let summary = ElevationFixtures.summary(altitude: [0, -10, 123.4, 405.6], basis: basis)
        let cached = try GPXFixtures.cached(summary)
        let snapshot = ActivityGPX(activity: activity).includingSampledElevation(from: cached)
        let document = try GPXDocument(snapshot.data())
        #expect(snapshot.hasSampledElevation && snapshot.simplified)
        #expect(document.points.count == 4)
        #expect(document.elevations == [0, -10, 123.4, 405.6])
        #expect(document.points.map(\.latitude) == summary.latlng?.map { $0[0] })
        #expect(document.points.map(\.longitude) == summary.latlng?.map { $0[1] })
        #expect(document.text["src"]?.contains("sampled route with averaged elevation") == true)
        #expect(!document.elements.contains("time"), "Export must not invent recording timestamps")
    }

    @Test func elevationCannotBeAttachedToUnrelatedRouteVerticesOrInvalidSources() throws {
        let activity = try StoredModelMapper.activity(Fixtures.activity())
        let original = ActivityGPX(activity: activity)
        let cached = try GPXFixtures.cached()
        let wrongID = try GPXFixtures.cached(id: "2")
        let stale = CachedStreamSummary(dto: cached.dto, codec: cached.codec, algorithmVersion: 1, isCurrent: false, storedAt: .now)
        let unknownCodec = CachedStreamSummary(dto: cached.dto, codec: "unsupported", algorithmVersion: 1, isCurrent: true, storedAt: .now)
        let unknownVersion = CachedStreamSummary(dto: cached.dto, codec: cached.codec, algorithmVersion: 2, isCurrent: true, storedAt: .now)
        let staleState = try GPXFixtures.cached(state: "stale")
        let noGPS = try GPXFixtures.cached(ElevationFixtures.summary(locations: nil))
        let noAltitude = try GPXFixtures.cached(ElevationFixtures.summary(altitude: nil))
        let compact = try #require(cached.dto.summary)
        let malformed = ActivityMapAPI.CompactStreamSummary(codec: compact.codec, algorithmVersion: 1,
            basis: compact.basis, count: compact.count, time: compact.time, distance: compact.distance,
            altitude: "?", watts: nil, heartrate: nil, latlng: compact.latlng)
        let malformedDTO = ActivityMapAPI.ActivityCompactStreamSummary(activityID: cached.activityID,
            metadata: cached.metadata, summary: malformed, lastError: nil, nextRetryAt: nil)
        let badSamples = CachedStreamSummary(dto: malformedDTO, codec: cached.codec, algorithmVersion: 1, isCurrent: true, storedAt: .now)
        for source in [wrongID, stale, unknownCodec, unknownVersion, staleState, noGPS, noAltitude, badSamples] {
            let snapshot = original.includingSampledElevation(from: source)
            let document = try GPXDocument(snapshot.data())
            #expect(!snapshot.hasSampledElevation && !document.elements.contains("ele"))
            #expect(document.points.count == activity.coordinates.count)
            #expect(document.points[0].latitude == activity.coordinates[0].latitude)
        }
    }

    @Test(arguments: ["Afternoon ride", "Zürich & <Alps> \"ride\" 'été' 🚲", "A\u{0}B\u{1}C\tD\nE"])
    func gpxParsesEscapedUnicodeMetadataAndOrderedCoordinates(name: String) throws {
        var activity = try StoredModelMapper.activity(Fixtures.activity())
        activity.name = name
        activity.description = "Rain & sun <3 \"quotes\" 'apostrophes'\nGrüezi 🚲"
        let data = try ActivityGPX(activity: activity).data()
        let document = try GPXDocument(data)
        #expect(document.namespace == "http://www.topografix.com/GPX/1/1")
        #expect(document.version == "1.1" && document.creator == "ActivityMap")
        #expect(document.text["name"] == name.replacingOccurrences(of: "\u{0}", with: "").replacingOccurrences(of: "\u{1}", with: ""))
        #expect(document.text["desc"] == activity.description)
        #expect(document.points.count == activity.coordinates.count)
        for (point, coordinate) in zip(document.points, activity.coordinates) {
            #expect(abs(point.latitude - coordinate.latitude) < 0.00000001)
            #expect(abs(point.longitude - coordinate.longitude) < 0.00000001)
        }
        #expect(!document.elements.contains("time") && !document.elements.contains("ele"))
    }

    @Test(arguments: [1, 2])
    func shortTracksAndAntimeridianRemainValid(count: Int) throws {
        var activity = ActivityStoreSelectionTests.activity(1)
        activity.coordinates = Array([CLLocationCoordinate2D(latitude: 90, longitude: 180),
                                      CLLocationCoordinate2D(latitude: -90, longitude: -179.99999)].prefix(count))
        let document = try GPXDocument(ActivityGPX(activity: activity).data())
        #expect(document.points.count == count)
        #expect(document.points[0].latitude == 90 && document.points[0].longitude == -180)
    }

    @Test(arguments: ["detailed", "summary", "refresh_required", "invalid-detailed"])
    func exportsTheMappersBestAvailableGeometry(state: String) throws {
        let activity = try StoredModelMapper.activity(Fixtures.activity([
            "geometry_state": state == "invalid-detailed" ? "detailed" : state,
            "map_polyline": state == "invalid-detailed" ? "bad" : "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
            "map_summary_polyline": "??",
        ]))
        let snapshot = ActivityGPX(activity: activity)
        let document = try GPXDocument(snapshot.data())
        #expect(document.points.count == (state == "detailed" ? 3 : 1))
        #expect(snapshot.simplified == (state != "detailed"))
        #expect(document.text["src"]?.contains(state == "detailed" ? "detailed" : "simplified") == true)
    }

    @Test func noGPSAndInvalidPointsCannotProduceMisleadingFiles() throws {
        var activity = ActivityStoreSelectionTests.activity(1)
        activity.coordinates = []
        #expect(throws: ActivityGPX.ExportError.self) { try ActivityGPX(activity: activity).data() }
        for coordinate in [CLLocationCoordinate2D(latitude: .nan, longitude: 0),
                           CLLocationCoordinate2D(latitude: 0, longitude: .infinity),
                           CLLocationCoordinate2D(latitude: 91, longitude: 0),
                           CLLocationCoordinate2D(latitude: 0, longitude: -181)] {
            activity.coordinates = [CLLocationCoordinate2D(latitude: 0, longitude: 0), coordinate]
            #expect(throws: ActivityGPX.ExportError.self) { try ActivityGPX(activity: activity).data() }
        }
    }

    @Test(arguments: ["../../a\\b:c?*", "..", " / ", String(repeating: "山🚲", count: 200)])
    func filenamesAreSafeAndByteBounded(name: String) {
        let filename = ActivityGPX.filename(name)
        #expect(filename.hasSuffix(".gpx") && filename.utf8.count <= 124)
        #expect(!filename.contains("/") && !filename.contains("\\") && !filename.contains(":"))
        #expect(!filename.hasPrefix(".") && filename != ".gpx")
    }

    @Test func offlineFileLeasesAreUniqueAndRemovedAfterUse() throws {
        let snapshot = ActivityGPX(activity: try StoredModelMapper.activity(Fixtures.activity()))
        var first: ActivityGPXFile? = try snapshot.write()
        let second = try snapshot.write()
        let firstURL = try #require(first?.url)
        #expect(firstURL != second.url)
        #expect(try GPXDocument(Data(contentsOf: firstURL)).points.count == 3)
        first = nil
        #expect(!FileManager.default.fileExists(atPath: firstURL.deletingLastPathComponent().path))
        #expect(FileManager.default.fileExists(atPath: second.url.path))
    }

    @Test func cancellationAndDiskErrorsLeaveNoExportBehind() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let snapshot = ActivityGPX(activity: try StoredModelMapper.activity(Fixtures.activity()))
        let cancelled = Task { try snapshot.write(in: root) }
        cancelled.cancel()
        await #expect(throws: CancellationError.self) { try await cancelled.value }
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path).isEmpty)
        let blocked = root.appendingPathComponent("not-a-directory")
        try Data().write(to: blocked)
        #expect(throws: (any Error).self) { try snapshot.write(in: blocked) }
        #expect(try FileManager.default.contentsOfDirectory(atPath: root.path) == ["not-a-directory"])
    }

    @Test func stravaPreservesFullIDAndUsesBrowserFallbackOnlyWhenNeeded() async throws {
        let id = 9_007_199_254_740_993
        var attempts: [(URL, Bool)] = []
        try await StravaActivityLink.open(activityID: id) { url, universalOnly in
            attempts.append((url, universalOnly)); return !universalOnly
        }
        #expect(attempts.count == 2 && attempts[0].1 && !attempts[1].1)
        #expect(attempts.allSatisfy { $0.0.absoluteString == "https://www.strava.com/activities/9007199254740993" })
        attempts = []
        try await StravaActivityLink.open(activityID: id) { url, universalOnly in
            attempts.append((url, universalOnly)); return true
        }
        #expect(attempts.count == 1 && attempts[0].1)
    }

    @Test func stravaReportsFailureAndCancellationDoesNotOpenBrowser() async throws {
        await #expect(throws: StravaActivityLink.OpenError.self) {
            try await StravaActivityLink.open(activityID: 1) { _, _ in false }
        }
        #expect(throws: StravaActivityLink.OpenError.self) { try StravaActivityLink.url(activityID: 0) }
        var attempts = 0
        let cancelled = Task {
            try await StravaActivityLink.open(activityID: 1) { _, _ in attempts += 1; return false }
        }
        cancelled.cancel()
        await #expect(throws: CancellationError.self) { try await cancelled.value }
        #expect(attempts == 0)
    }
}

nonisolated enum GPXFixtures {
    static func cached(_ summary: ActivityMapAPI.StreamSummary = ElevationFixtures.summary(),
                       id: String = StreamFixtures.activityID, state: String = "current") throws -> CachedStreamSummary {
        let metadata = try ActivityMapAPI.makeDecoder().decode(ActivityMapAPI.StreamMetadata.self,
            from: Data(StreamFixtures.metadataJSON(state: state).utf8))
        let dto = ActivityMapAPI.ActivityCompactStreamSummary(activityID: id, metadata: metadata,
            summary: try CompactStreamCodec.encode(summary), lastError: nil, nextRetryAt: nil)
        return CachedStreamSummary(dto: dto, codec: "polyline-v1", algorithmVersion: 1, isCurrent: true,
                                   storedAt: Date().addingTimeInterval(-40 * 86400))
    }
}

nonisolated private final class GPXDocument: NSObject, XMLParserDelegate {
    struct Point { let latitude: Double; let longitude: Double }
    var namespace: String?
    var version: String?
    var creator: String?
    var elements = Set<String>()
    var text: [String: String] = [:]
    var points: [Point] = []
    var elevations: [Double] = []
    private var current = ""

    init(_ data: Data) throws {
        super.init()
        let parser = XMLParser(data: data)
        parser.shouldProcessNamespaces = true
        parser.delegate = self
        guard parser.parse() else { throw parser.parserError ?? CocoaError(.fileReadCorruptFile) }
    }
    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?,
                qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
        elements.insert(elementName); current = elementName
        if elementName == "gpx" { namespace = namespaceURI; version = attributeDict["version"]; creator = attributeDict["creator"] }
        if elementName == "trkpt", let lat = attributeDict["lat"].flatMap(Double.init), let lon = attributeDict["lon"].flatMap(Double.init) {
            points.append(Point(latitude: lat, longitude: lon))
        }
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if ["name", "desc", "src", "ele"].contains(current) { text[current, default: ""] += string }
    }
    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        if elementName == "ele" {
            if let value = text["ele"].flatMap(Double.init) { elevations.append(value) }
            text["ele"] = nil
        }
        current = ""
    }
}

import Foundation
import Testing
@testable import ActivityMap

nonisolated enum ElevationFixtures {
    static func summary(distance: [Double] = [100, 200, 600, 1100], altitude: [Double]? = [400, 410, 405, 450],
                        locations: [[Double]]? = [[47, 8], [47.001, 8.001], [47.002, 8.003], [47.004, 8.005]],
                        basis: ActivityMapAPI.StreamSeriesType? = .distance) -> ActivityMapAPI.StreamSummary {
        .init(version: 1, basis: basis, time: distance.indices.map(Double.init), distance: distance,
              latlng: locations, altitude: altitude, watts: nil, heartrate: nil)
    }
    static func dto(id: String = "1") throws -> ActivityMapAPI.ActivityCompactStreamSummary {
        let metadata = try ActivityMapAPI.makeDecoder().decode(ActivityMapAPI.StreamMetadata.self,
            from: Data(StreamFixtures.metadataJSON().utf8))
        return .init(activityID: id, metadata: metadata, summary: try CompactStreamCodec.encode(summary()),
                     lastError: nil, nextRetryAt: nil)
    }
    static func cached() throws -> CachedStreamSummary {
        .init(dto: try dto(), codec: "polyline-v1", algorithmVersion: 1, isCurrent: true, storedAt: .now)
    }
}

struct ElevationProfileTests {
    @Test func preservesAlignedSamplesAndRelativeDistance() throws {
        let profile = try #require(ElevationProfile.decode(ElevationFixtures.cached()))
        #expect(profile.points.map(\.distance) == [0, 100, 500, 1000])
        #expect(profile.points.map(\.altitude) == [400, 410, 405, 450])
        #expect(profile.span == 1000 && profile.usesKilometres)
        let point = profile.nearest(to: 510)
        #expect(point.id == 2 && point.latitude == 47.002 && point.longitude == 8.003)
        #expect(profile.nearest(to: -20).id == 0)
        #expect(profile.nearest(to: 5000).id == 3)
    }

    @Test func selectionReadoutUsesCompactSharedUnits() throws {
        let profile = try #require(ElevationProfile.make(ElevationFixtures.summary(distance: [0, 91910, 150000, 182600], altitude: [400, 489.8, 500, 550])))
        #expect(profile.selectionLabel(profile.points[1]) == "91.9 km · 490 m")
    }

    @Test func shortFlatAndRepeatedDistanceSamplesRemainDrawable() throws {
        let profile = try #require(ElevationProfile.make(ElevationFixtures.summary(
            distance: [20, 20, 25, 30], altitude: [0, 0, 0, 0])))
        #expect(profile.points.count == 4 && profile.points[1].distance == 0)
        #expect(profile.span == 10 && !profile.usesKilometres && profile.distanceUnit == "m")
        #expect(profile.altitudeDomain == -5...5)
        #expect(profile.minimum == 0 && profile.maximum == 0)
    }

    @Test func rejectsNonForwardMissingMisalignedTimeOnlyAndInvalidValues() {
        for distance in [[0, 100, 50, 200], [10, 10, 10, 10], [0], [0, .nan, 2, 3], [-1, 0, 1, 2]] {
            #expect(ElevationProfile.make(ElevationFixtures.summary(distance: distance)) == nil)
        }
        #expect(ElevationProfile.make(ElevationFixtures.summary(altitude: nil)) == nil)
        #expect(ElevationProfile.make(ElevationFixtures.summary(altitude: [1, 2])) == nil)
        #expect(ElevationProfile.make(ElevationFixtures.summary(altitude: [1, 2, .infinity, 4])) == nil)
        let timed = ElevationFixtures.summary(basis: .time)
        #expect(ElevationProfile.make(timed)?.samplingBasis == .time)
        let timeOnly = ActivityMapAPI.StreamSummary(version: 1, basis: .time, time: [0, 10, 20],
            distance: nil, latlng: nil, altitude: [1, 2, 3], watts: nil, heartrate: nil)
        #expect(ElevationProfile.make(timeOnly) == nil)
        #expect(ElevationProfile.make(ElevationFixtures.summary(basis: nil)) == nil)
    }

    @Test func missingOrMalformedGPSDoesNotInventMapLocations() throws {
        let cases: [[[Double]]?] = [nil, [[47, 8]], [[100, 8], [47, 8], [47, 8], [47, 8]]]
        for locations in cases {
            let profile = try #require(ElevationProfile.make(ElevationFixtures.summary(locations: locations)))
            #expect(!profile.hasLocations && profile.points.allSatisfy { $0.latitude == nil && $0.longitude == nil })
        }
    }

    @Test func statusHonorsRetryAndOfflineContext() {
        let deadline = Date().addingTimeInterval(60)
        let pending = ElevationStatus(state: .pending(retryAt: deadline, paused: true), hasProfile: false, offline: false)
        #expect(pending.canRetry && pending.retryAt == deadline)
        let terminal = ElevationStatus(state: .failed(.init(message: "Unavailable", retryable: false, retryAt: nil, requestID: nil)), hasProfile: false, offline: false)
        #expect(!terminal.canRetry)
        let stale = ElevationStatus(state: .stale(nil), hasProfile: false, offline: true)
        #expect(stale.canRetry && stale.message == "Recorded data changed.")
    }
}

@MainActor struct ElevationLifecycleTests {
    @Test func longOfflineProfileAndMarkerInvalidateWithSourceDeletionAndLogout() async throws {
        let storage = try LocalStore(container: LocalStore.makeContainer(inMemory: true))
        let dto = try ElevationFixtures.dto()
        let metadata = try JSONSerialization.jsonObject(with: Data(StreamFixtures.metadataJSON().utf8))
        let activity = try Fixtures.activity(["id": "1", "streams": metadata])
        try await storage.apply([.upsertActivity(activity)], scope: Fixtures.scope)
        let fence = await storage.streamFence()
        _ = try await storage.saveStreamSummary(dto, scope: Fixtures.scope, fence: fence, now: Date().addingTimeInterval(-40 * 86400))
        let source = SummarySourceProbe([])
        let loader = StreamSummaryLoader(source: { _ in source })
        await loader.configure(SyncFixtures.session(verified: false), storage: storage)
        await loader.load(activityID: "1")
        let cached = try #require(loader.currentSummary(for: "1"))
        let profile = try #require(ElevationProfile.decode(cached))
        let store = ActivityStore(activities: [try StoredModelMapper.activity(activity)])
        store.streamSummaries = loader
        store.replaceSelection(with: [1]); store.activate(1)
        store.elevationCursor = .init(owner: UUID(), activityID: 1, cached: cached, point: profile.points[2])
        #expect(store.elevationCoordinate?.latitude == 47.002)
        #expect(await source.calls == 0)
        #expect(ElevationStatus(state: loader.state(for: "1"), hasProfile: true, offline: loader.isOffline).message.isEmpty)
        store.selectedTab = .list
        #expect(store.elevationCoordinate == nil)
        store.selectedTab = .map
        let staleMetadata = try JSONSerialization.jsonObject(with: Data(StreamFixtures.metadataJSON(generation: "g2", state: "stale").utf8))
        try await storage.apply([.upsertActivity(try Fixtures.activity(["id": "1", "streams": staleMetadata]))], scope: Fixtures.scope)
        for _ in 0..<100 where loader.currentSummary(for: "1") != nil { try await Task.sleep(for: .milliseconds(10)) }
        #expect(loader.currentSummary(for: "1") == nil && store.elevationCoordinate == nil)
        try await storage.apply([.deleteActivity("1")], scope: Fixtures.scope)
        store.activities = []
        #expect(store.elevationCoordinate == nil)
        loader.reset(); store.clearScope()
        #expect(store.elevationCursor == nil && loader.cachedSummaries.isEmpty)
    }
}

import Foundation
import CoreGraphics
import MapboxMaps
import Observation

/// Map results presentation and hit-query lifetime, separate from list inspection.
@MainActor @Observable
final class RoutePicker {
    private static let unavailableMessage = "Routes could not be selected. Wait for the map to load and try again."

    var isAdding = false
    var isPresented = false
    var detent = MapResultsDetent.medium
    enum NavigationMotion { case forward, backward, none }
    private(set) var navigationMotion = NavigationMotion.none
    var isPaging = false
    var detailID: Int?
    var errorMessage: String?
    private(set) var candidateIDs: [Int] = []
    @ObservationIgnored private var pendingQuery: Cancelable?
    @ObservationIgnored private var generation = 0

    @discardableResult
    func invalidateQuery() -> Int {
        generation += 1
        pendingQuery?.cancel()
        pendingQuery = nil
        return generation
    }

    func pick(at point: CGPoint, map: MapboxMap, store: ActivityStore) {
        let request = invalidateQuery()
        let revision = store.activitiesRevision
        guard store.routeGeometry.revision == revision else { return }
        guard map.isStyleLoaded, map.layerExists(withId: RouteSource.ordinaryLayerID) else {
            errorMessage = Self.unavailableMessage
            return
        }
        let visibleIDs = store.visibleActivityIDs
        let adding = isAdding
        let rect = CGRect(x: point.x - RouteHitTesting.radius, y: point.y - RouteHitTesting.radius,
                          width: RouteHitTesting.radius * 2, height: RouteHitTesting.radius * 2)
        // Query only the ordinary route layer: no raster/POI/photo feature can
        // become an activity hit, and casing/highlight copies are excluded.
        pendingQuery = map.queryRenderedFeatures(
            with: rect,
            options: RenderedQueryOptions(layerIds: [RouteSource.ordinaryLayerID], filter: nil)
        ) { [weak self, weak map, weak store] result in
            guard let self, let map, let store,
                  request == self.generation,
                  revision == store.activitiesRevision,
                  visibleIDs == store.visibleActivityIDs else { return }
            self.pendingQuery = nil
            switch result {
            case let .success(features):
                let ids = RouteHitTesting.orderedIDs(
                    features: features.map { $0.queriedFeature.feature },
                    at: point, eligibleIDs: visibleIDs, project: map.points(for:)
                )
                self.apply(ids: ids, adding: adding, request: request, store: store)
            case .failure:
                // A loading/failed style is not an empty-map selection tap.
                self.errorMessage = Self.unavailableMessage
            }
        }
    }

    /// The query token also fences late callbacks after gestures or tab changes.
    func apply(ids: [Int], adding: Bool, request: Int, store: ActivityStore) {
        guard request == generation else { return }
        let eligible = Set(store.filteredActivities.filter { $0.coordinates.count > 1 }.map(\.id))
        var seen = Set<Int>()
        let hits = ids.filter { eligible.contains($0) && seen.insert($0).inserted }
        errorMessage = nil
        navigationMotion = .none
        detailID = nil
        if hits.isEmpty {
            // Explicit contract: empty-map taps clear, including in Add mode.
            store.clearSelection()
            reconcile(with: store)
            return
        }
        if adding {
            store.addToSelection(hits)
        } else {
            store.replaceSelection(with: hits)
            if hits.count == 1 { detailID = hits.first }
        }
        candidateIDs = hits
        reconcile(with: store)
        isPresented = true
        if detent == .compact { detent = .medium }
    }

    func reconcile(with store: ActivityStore) {
        invalidateQuery()
        let visible = store.visibleSelectedActivityIDs
        candidateIDs = candidateIDs.filter(visible.contains)
            + visible.subtracting(candidateIDs).sorted(by: >)
        if let detailID, detailID != store.activeActivityID {
            navigationMotion = .none
            self.detailID = store.activeActivityID
        }
        if store.selectedActivityIDs.isEmpty {
            isPresented = false
            detailID = nil
            isAdding = false
            detent = .medium
        } else if !isPresented {
            // A selection always has its results panel, including one made in
            // List or Stats; its handle shrinks it instead of a hide action.
            isPresented = true
        }
    }

    func reviewSelection(store: ActivityStore) {
        navigationMotion = .none
        reconcile(with: store)
        if candidateIDs.count == 1, let id = candidateIDs.first { store.activate(id) }
        detailID = store.activeActivityID
        isPresented = !store.selectedActivityIDs.isEmpty
    }

    /// Back changes presentation only: retain selection, active route and camera.
    func showResults() {
        navigationMotion = .backward
        detailID = nil
    }

    func step(_ offset: Int, store: ActivityStore) {
        reconcile(with: store)
        guard !candidateIDs.isEmpty else { return }
        let index = detailID.flatMap { candidateIDs.firstIndex(of: $0) } ?? 0
        let next = (index + offset + candidateIDs.count) % candidateIDs.count
        showDetail(candidateIDs[next], store: store, motion: offset < 0 ? .backward : .forward)
    }

    func showDetail(_ id: Int, store: ActivityStore, motion: NavigationMotion = .forward) {
        guard store.selectedActivityIDs.contains(id), store.visibleActivityIDs.contains(id) else { return }
        navigationMotion = motion
        store.activate(id)
        detailID = id
        isPresented = true
    }
}

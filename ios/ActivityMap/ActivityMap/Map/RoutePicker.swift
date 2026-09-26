import Foundation
import CoreGraphics
import MapboxMaps
import Observation

/// Transient map UI, kept separate from independent list inspection.
@MainActor @Observable
final class RoutePicker {
    private static let unavailableMessage = "Routes could not be selected. Wait for the map to load and try again."

    var isAdding = false
    var isPresented = false
    var sheetHeight: CGFloat = 0
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
        let visibleIDs = store.selection.visibleIDs
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
                  visibleIDs == store.selection.visibleIDs else { return }
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
        candidateIDs = ids.filter { eligible.contains($0) && seen.insert($0).inserted }
        errorMessage = nil
        detailID = nil
        if candidateIDs.isEmpty {
            // Explicit contract: empty-map taps clear, including in Add mode.
            store.clearSelection()
            isPresented = false
            return
        }
        if adding {
            store.addToSelection(candidateIDs)
        } else {
            store.replaceSelection(with: candidateIDs)
            if candidateIDs.count == 1 { detailID = candidateIDs.first }
        }
        isPresented = true
    }

    func reconcile(with store: ActivityStore) {
        invalidateQuery()
        candidateIDs.removeAll { !store.selection.visibleIDs.contains($0) }
        if let detailID, detailID != store.activeActivityID { self.detailID = nil }
        if candidateIDs.isEmpty { isPresented = false }
    }

    func reviewSelection(store: ActivityStore) {
        invalidateQuery()
        candidateIDs = store.selection.visibleSelectedIDs.sorted(by: >)
        detailID = nil
        isPresented = !candidateIDs.isEmpty
    }

    func showDetail(_ id: Int, store: ActivityStore) {
        guard store.selectedActivityIDs.contains(id), store.selection.visibleIDs.contains(id) else { return }
        store.activate(id)
        detailID = id
    }
}

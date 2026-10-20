import Charts
import SwiftUI
import UIKit

struct ElevationProfileView: View {
    let store: ActivityStore
    let activityID: Int
    var isRelevant = true
    var compact = false
    @State private var decoded: Decoded?
    @State private var selectedDistance: Double?
    @State private var owner = UUID()
    @State private var retry = 0
    @State private var refresh = false
    @ScaledMetric(relativeTo: .caption) private var reservedHeight = 200.0
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private struct Decoded {
        let cached: CachedStreamSummary
        let profile: ElevationProfile?
    }
    private struct Demand: Equatable {
        let activityID: Int
        let relevant: Bool
        let sessionRevision: Int?
        let retry: Int
    }
    private var loader: StreamSummaryLoader? { store.streamSummaries }
    private var cached: CachedStreamSummary? { loader?.currentSummary(for: String(activityID)) }
    // Relevance gates demand, decoding and the cursor, not presentation: a
    // profile decoded for this source stays on screen while the map sheet is
    // dragged through the reveal threshold.
    private var profile: ElevationProfile? {
        guard decoded?.cached == cached else { return nil }
        return decoded?.profile
    }

    /// The server has no elevation by distance for this activity, so the
    /// detail reserves no space for it. Loading and pending states reserve
    /// chart space; failures use a compact recovery row.
    private var hasNoProfile: Bool {
        switch state {
        case .unavailable: return true
        case .current: return decoded?.cached == cached && decoded?.profile == nil
        default: return false
        }
    }

    var body: some View {
        if hasNoProfile { EmptyView() } else { content }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 8) {
            Group {
                if let profile {
                    ElevationPlot(profile: profile, compact: compact, selectedX: $selectedDistance) { point in
                        guard let point else { clearCursor(); return }
                        guard isRelevant, let cached else { return }
                        let next = ElevationCursor(owner: owner, activityID: activityID, cached: cached, point: point)
                        if store.elevationCursor != next { store.elevationCursor = next }
                    } onDrag: { dragging in
                        if dragging, isRelevant { store.elevationScrubOwner = owner }
                        else if store.elevationScrubOwner == owner { store.elevationScrubOwner = nil }
                    }
                    .id(cached)
                } else if usesCompactStatus {
                    statusTimeline
                        .padding(.vertical, 8)
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(placeholder).foregroundStyle(AppTheme.secondaryText)
                        statusTimeline
                    }
                    .font(.caption)
                    .frame(maxWidth: .infinity, minHeight: compact ? reservedHeight * 0.75 : reservedHeight, alignment: .center)
                    .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            if profile != nil && (statusPresentation.canRetry || !statusPresentation.message.isEmpty) {
                statusTimeline
            }
        }
        .accessibilityIdentifier("elevation-profile")
        .task(id: Demand(activityID: activityID, relevant: isRelevant,
                         sessionRevision: loader?.sessionRevision, retry: retry)) {
            guard isRelevant, let loader else { clearCursor(); return }
            let shouldRefresh = refresh
            refresh = false
            await loader.load(activityID: String(activityID), refresh: shouldRefresh)
        }
        .task(id: isRelevant ? cached : nil) {
            clearCursor()
            // Keep an already decoded source across relevance changes, such as
            // dragging the map sheet through its reveal threshold.
            guard isRelevant, let cached, decoded?.cached != cached else { return }
            decoded = nil
            let worker = Task.detached(priority: .userInitiated) { ElevationProfile.decode(cached) }
            let result = await withTaskCancellationHandler { await worker.value } onCancel: { worker.cancel() }
            guard !Task.isCancelled, self.cached == cached else { return }
            decoded = Decoded(cached: cached, profile: result)
        }
        .onDisappear { clearCursor() }
    }

    /// Re-render only when a retry deadline passes, not every second.
    private var statusTimeline: some View {
        TimelineView(.explicit(statusPresentation.retryAt.map { [$0] } ?? [])) { _ in
            status(now: .now)
        }
    }

    private var isDecoding: Bool { cached != nil && decoded?.cached != cached }
    private var state: StreamSummaryState { loader?.state(for: String(activityID)) ?? .notRequested }
    private var usesCompactStatus: Bool {
        guard !isDecoding else { return false }
        switch state { case .failed, .stale: return true; default: return false }
    }
    private var placeholder: String {
        // Downloading and local decoding share one quiet loading presentation.
        if isDecoding { return "Loading elevation samples…" }
        return switch state {
        case .loading, .notRequested: loader == nil ? "Elevation by distance is unavailable." : "Loading elevation samples…"
        case .pending: "Elevation samples are being prepared."
        case .stale: "The recorded data changed. Reload this profile."
        case .failed: "Couldn’t load the elevation profile."
        case .current, .unavailable: "Elevation by distance is unavailable for this activity."
        }
    }

    private var statusPresentation: ElevationStatus {
        ElevationStatus(state: state, hasProfile: profile != nil, offline: loader?.isOffline == true)
    }

    @ViewBuilder private func status(now: Date) -> some View {
        let presentation = statusPresentation
        if !presentation.message.isEmpty || presentation.canRetry {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
        layout {
          HStack(alignment: .center, spacing: 12) {
            if profile == nil && usesCompactStatus {
                Image(systemName: presentation.isOffline ? "wifi.slash" : "chart.xyaxis.line")
                    .foregroundStyle(AppTheme.secondaryText)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(presentation.message).font(.caption).foregroundStyle(AppTheme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
                if let deadline = presentation.retryAt, deadline > now {
                    Text("Try again after \(deadline.formatted(date: .omitted, time: .standard))")
                        .font(.caption).foregroundStyle(AppTheme.secondaryText)
                }
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
            if presentation.canRetry {
                Button("Retry") { refresh = profile != nil; retry += 1 }
                    .font(.caption)
                    .accessibilityLabel("Retry elevation profile")
                    .disabled(presentation.retryAt.map { $0 > now } ?? false)
                    .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        }
    }
    private func clearCursor() {
        selectedDistance = nil
        if store.elevationCursor?.owner == owner { store.elevationCursor = nil }
        if store.elevationScrubOwner == owner { store.elevationScrubOwner = nil }
    }
}

nonisolated struct ElevationStatus {
    let message: String
    let canRetry: Bool
    let retryAt: Date?
    let isOffline: Bool
    init(state: StreamSummaryState, hasProfile: Bool, offline: Bool) {
        if case .failed(let failure) = state { isOffline = offline || failure.isOffline }
        else { isOffline = offline }
        switch state {
        case .failed(let failure):
            message = isOffline
                ? (hasProfile ? "Connect to update the saved profile." : "Elevation profile not saved offline. Connect to load it.")
                : (hasProfile ? "Couldn’t update the profile." : "Elevation profile couldn’t be loaded.")
            canRetry = failure.retryable; retryAt = failure.retryAt
        case .pending(let date, let paused):
            message = paused ? "Profile preparation paused." : "Preparing elevation samples…"
            canRetry = paused; retryAt = date
        case .stale:
            message = "Recorded data changed."
            canRetry = true; retryAt = nil
        case .loading, .notRequested:
            message = hasProfile ? "Updating saved profile…" : ""
            canRetry = false; retryAt = nil
        case .current, .unavailable:
            message = ""
            canRetry = false; retryAt = nil
        }
    }
}

struct ElevationPlot: View {
    @Environment(\.locale) private var locale
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    private var units: UnitSystem { preferences?.units ?? .metric }
    let profile: ElevationProfile
    var compact = false
    @Binding var selectedX: Double?
    var onSelection: (ElevationProfile.Point?) -> Void = { _ in }
    var onDrag: (Bool) -> Void = { _ in }
    @State private var accessibleSampleID: Int?
    @State private var marker = ElevationMarker()
    @ScaledMetric(relativeTo: .caption) private var chartHeight = 160.0
    @ScaledMetric(relativeTo: .caption) private var reservedHeight = 200.0
    private var selected: ElevationProfile.Point? {
        guard let selectedX else { return nil }
        if let accessibleSampleID, let point = profile.points.first(where: { $0.id == accessibleSampleID }),
           point.distance / profile.distanceDivisor(units: units) == selectedX { return point }
        return profile.nearest(to: selectedX * profile.distanceDivisor(units: units))
    }

    private var gestureSelection: Binding<Double?> {
        Binding(get: { selectedX }, set: { value in
            accessibleSampleID = nil
            selectedX = value
            marker.point = value.map { profile.nearest(to: $0 * profile.distanceDivisor(units: units)) }
        })
    }
    private var hasGestureSelection: Bool { selectedX != nil && accessibleSampleID == nil }

    var body: some View {
        #if DEBUG
        let _ = PerfProbe.count("ElevationPlot")
        #endif
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("Elevation (\(units.elevationUnit))").foregroundStyle(AppTheme.secondaryText)
                Spacer(minLength: 0)
                Text(selected.map { profile.selectionLabel($0, units: units, locale: locale) } ?? " ")
                    .fontWeight(.medium).monospacedDigit()
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 6).padding(.vertical, 3)
                    .background(Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 5))
                    .opacity(selected == nil ? 0 : 1)
                    .accessibilityHidden(true)
                    .accessibilityIdentifier("elevation-selection-readout")
            }
            .font(.caption)
            .fixedSize(horizontal: false, vertical: true)
            .frame(minHeight: 24)
            ElevationChart(profile: profile, units: units, marker: marker) { gestureSelection.wrappedValue = $0 }
                .equatable()
            .frame(height: compact ? reservedHeight * 0.75 - 32 : chartHeight)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Elevation profile, \(profile.accessibilityDescription(units: units, locale: locale))")
            .accessibilityValue(selected.map { profile.valueLabel($0, units: units, locale: locale) } ?? "No sample selected")
            .accessibilityHint("Swipe up or down to move through recorded samples.")
            .accessibilityAdjustableAction { direction in
                let index = selected?.id ?? 0
                switch direction {
                case .increment: select(profile.points[min(profile.points.count - 1, selected == nil ? 0 : index + 1)])
                case .decrement: select(profile.points[max(0, index - 1)])
                @unknown default: break
                }
            }
            .accessibilityAction(named: "Clear selected sample") { select(nil) }
        }
        .frame(minHeight: compact ? reservedHeight * 0.75 : reservedHeight, alignment: .top)
        .onChange(of: units) { _, _ in select(nil) }
        .onChange(of: selected?.id) { _, _ in onSelection(selected) }
        // Selections from the host binding; gestures update the marker directly.
        .onChange(of: selected, initial: true) { _, point in
            if marker.point != point { marker.point = point }
        }
        .onChange(of: hasGestureSelection) { _, selecting in onDrag(selecting) }
        .onDisappear { select(nil); onSelection(nil); onDrag(false) }
    }
    private func select(_ point: ElevationProfile.Point?) {
        accessibleSampleID = point?.id
        selectedX = point.map { $0.distance / profile.distanceDivisor(units: units) }
        marker.point = point
    }
}

/// The selected sample, observed only by the marker layer over the chart.
@Observable final class ElevationMarker {
    var point: ElevationProfile.Point?
}

/// Every recorded sample as area and line marks (up to 600). Scrubbing changes
/// only the marker layer, so this plot is neither rebuilt nor laid out again.
private struct ElevationChart: View, Equatable {
    let profile: ElevationProfile
    let units: UnitSystem
    let marker: ElevationMarker
    /// Chart x value under the finger, or nil once it lifts.
    let select: (Double?) -> Void

    nonisolated static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.profile == rhs.profile && lhs.units == rhs.units && lhs.marker === rhs.marker
    }

    var body: some View {
        Chart {
            ForEach(profile.points) { point in
                AreaMark(x: .value("Distance", point.distance / profile.distanceDivisor(units: units)),
                         yStart: .value("Baseline", profile.altitudeDomain.lowerBound / units.elevationScale), yEnd: .value("Elevation", point.altitude / units.elevationScale))
                    .foregroundStyle(AppTheme.accent.opacity(0.15))
                    .interpolationMethod(.linear)
                LineMark(x: .value("Distance", point.distance / profile.distanceDivisor(units: units)), y: .value("Elevation", point.altitude / units.elevationScale))
                    .foregroundStyle(AppTheme.accent).lineStyle(StrokeStyle(lineWidth: 2))
                    .interpolationMethod(.linear)
            }
        }
        .chartXScale(domain: 0...(profile.span / profile.distanceDivisor(units: units)))
        .chartYScale(domain: (profile.altitudeDomain.lowerBound / units.elevationScale)...(profile.altitudeDomain.upperBound / units.elevationScale))
        .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) }
        .chartYAxis { AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) }
        .chartXAxisLabel("Distance (\(profile.distanceUnit(units: units)))", alignment: .center)
        .chartOverlay { proxy in
            GeometryReader { geometry in
                let plot = proxy.plotFrame.map { geometry[$0] } ?? .zero
                ElevationMarkerLayer(marker: marker, profile: profile, units: units, proxy: proxy, plot: plot)
                Color.clear.contentShape(Rectangle())
                    .gesture(ElevationScrubGesture(bounds: geometry.size) { location in
                        guard let location, proxy.plotFrame != nil else { select(nil); return }
                        let x = min(max(0, location.x - plot.minX), plot.width)
                        select(proxy.value(atX: x, as: Double.self))
                    })
            }
        }
    }
}

/// Draws what the chart's RuleMark and PointMark did, in plot coordinates.
private struct ElevationMarkerLayer: View {
    let marker: ElevationMarker
    let profile: ElevationProfile
    let units: UnitSystem
    let proxy: ChartProxy
    let plot: CGRect

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let point = marker.point,
               let x = proxy.position(forX: point.distance / profile.distanceDivisor(units: units)),
               let y = proxy.position(forY: point.altitude / units.elevationScale) {
                Path { path in
                    path.move(to: CGPoint(x: plot.minX + x, y: plot.minY))
                    path.addLine(to: CGPoint(x: plot.minX + x, y: plot.maxY))
                }
                .stroke(.secondary, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                // PointMark's symbolSize(45) is the symbol's area.
                Circle().fill(AppTheme.accent)
                    .frame(width: 7.6, height: 7.6)
                    .position(x: plot.minX + x, y: plot.minY + y)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .allowsHitTesting(false)
    }
}

/// Reject vertical movement before recognition so the enclosing scroll view
/// keeps native scrolling and overscroll, including when a pull starts on a chart.
private struct ElevationScrubGesture: UIGestureRecognizerRepresentable {
    let bounds: CGSize
    let select: (CGPoint?) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator {
        Coordinator(converter: converter, bounds: bounds)
    }
    func updateUIGestureRecognizer(_ recognizer: UIPanGestureRecognizer, context: Context) {
        context.coordinator.bounds = bounds
    }
    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.maximumNumberOfTouches = 1
        pan.delegate = context.coordinator
        return pan
    }
    func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
        switch pan.state {
        case .began, .changed: select(context.converter.localLocation)
        case .ended, .cancelled, .failed: select(nil)
        default: break
        }
    }
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        let converter: CoordinateSpaceConverter
        var bounds: CGSize
        init(converter: CoordinateSpaceConverter, bounds: CGSize) {
            self.converter = converter
            self.bounds = bounds
        }
        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let pan = recognizer as? UIPanGestureRecognizer else { return false }
            let location = converter.localLocation
            let translation = converter.localTranslation ?? .zero
            let origin = CGPoint(x: location.x - translation.x, y: location.y - translation.y)
            guard CGRect(origin: .zero, size: bounds).contains(origin) else { return false }
            let velocity = pan.velocity(in: pan.view)
            return abs(velocity.x) > abs(velocity.y)
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            otherGestureRecognizer.view is UIScrollView
        }
    }
}

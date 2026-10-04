import Charts
import SwiftUI

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

    var body: some View {
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
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        if isDecoding { ProgressView("Reading elevation samples…") }
                        else { Text(placeholder).foregroundStyle(AppTheme.secondaryText) }
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
    private var placeholder: String {
        switch state {
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
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                Text(presentation.message).font(.caption).foregroundStyle(AppTheme.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
                if let deadline = presentation.retryAt, deadline > now {
                    Text("Try again after \(deadline.formatted(date: .omitted, time: .standard))")
                        .font(.caption).foregroundStyle(AppTheme.secondaryText)
                }
            }
            Spacer(minLength: 0)
            if presentation.canRetry {
                Button("Try again") { refresh = profile != nil; retry += 1 }
                    .disabled(presentation.retryAt.map { $0 > now } ?? false)
                    .frame(minHeight: 44).fixedSize(horizontal: true, vertical: false)
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
    init(state: StreamSummaryState, hasProfile: Bool, offline: Bool) {
        switch state {
        case .failed(let failure):
            message = hasProfile ? "Couldn’t update the profile." : ""
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
    let profile: ElevationProfile
    var compact = false
    @Binding var selectedX: Double?
    var onSelection: (ElevationProfile.Point?) -> Void = { _ in }
    var onDrag: (Bool) -> Void = { _ in }
    @GestureState private var isDragging = false
    @State private var accessibleSampleID: Int?
    @ScaledMetric(relativeTo: .caption) private var chartHeight = 160.0
    @ScaledMetric(relativeTo: .caption) private var reservedHeight = 200.0
    private var units: UnitSystem { DisplayPreferences.shared.units }
    private var selected: ElevationProfile.Point? {
        guard let selectedX else { return nil }
        if let accessibleSampleID, let point = profile.points.first(where: { $0.id == accessibleSampleID }),
           point.distance / profile.distanceDivisor(units: units) == selectedX { return point }
        return profile.nearest(to: selectedX * profile.distanceDivisor(units: units))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("Elevation (\(units.elevationUnit))").foregroundStyle(AppTheme.secondaryText)
                Spacer(minLength: 0)
                Text(selected.map { profile.selectionLabel($0, units: units) } ?? " ")
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
                if let selected {
                    RuleMark(x: .value("Distance", selected.distance / profile.distanceDivisor(units: units)))
                        .foregroundStyle(.secondary).lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    PointMark(x: .value("Distance", selected.distance / profile.distanceDivisor(units: units)), y: .value("Elevation", selected.altitude / units.elevationScale))
                        .foregroundStyle(AppTheme.accent).symbolSize(45)

                }
            }
            .chartXScale(domain: 0...(profile.span / profile.distanceDivisor(units: units)))
            .chartYScale(domain: (profile.altitudeDomain.lowerBound / units.elevationScale)...(profile.altitudeDomain.upperBound / units.elevationScale))
            .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) }
            .chartYAxis { AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) }
            .chartXAxisLabel("Distance (\(profile.distanceUnit(units: units)))", alignment: .center)
            .chartXSelection(value: $selectedX)
            .chartGesture { proxy in
                DragGesture(minimumDistance: 0)
                    .updating($isDragging) { _, dragging, _ in dragging = true }
                    .onChanged { value in
                        accessibleSampleID = nil
                        proxy.selectXValue(at: value.location.x)
                    }
                    .onEnded { _ in selectedX = nil }
            }
            .frame(height: compact ? reservedHeight * 0.75 - 32 : chartHeight)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Elevation profile, \(profile.accessibilityDescription(units: units))")
            .accessibilityValue(selected.map { profile.valueLabel($0, units: units) } ?? "No sample selected")
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
        .onChange(of: isDragging) { _, dragging in
            onDrag(dragging)
            if !dragging { select(nil) }
        }
        .onDisappear { select(nil); onSelection(nil); onDrag(false) }
    }
    private func select(_ point: ElevationProfile.Point?) {
        accessibleSampleID = point?.id
        selectedX = point.map { $0.distance / profile.distanceDivisor(units: units) }
    }
}

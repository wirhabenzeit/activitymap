import SwiftUI

/// Persistent adaptive results surface; the map owns its position and footprint.
struct RoutePickerSheet: View {
    @Bindable var picker: RoutePicker
    @Bindable var store: ActivityStore
    let isSidePanel: Bool
    var bottomInset: CGFloat = 0
    var panelExpandedHeight: CGFloat? = nil
    var collapsedOverride: Bool? = nil
    var panelHandle: AnyView? = nil
    private var expansion: CGFloat { collapsed ? 0 : 1 }
    private var contentReveal: CGFloat { expansion }
    var nativePresentation = false
    private var collapsed: Bool { collapsedOverride ?? (picker.detent == .compact) }
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var panelHeaderHeight: CGFloat = 44
    @State private var resultsViewportHeight: CGFloat = 0

    private var candidates: [Activity] {
        picker.candidateIDs.filter(store.visibleActivityIDs.contains).compactMap { store.activity(id: $0) }
    }
    private var detail: Activity? { candidates.first { $0.id == picker.detailID } }

    var body: some View {
        VStack(spacing: 0) {
            if isSidePanel {
                sidePanelHeader
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: {
                        if !collapsed { panelHeaderHeight = $0 }
                    }
            } else { header }
            // Keep results mounted through detail and detent changes. Back
            // restores the exact scroll position, without a second overlay.
            GeometryReader { viewport in
                ZStack {
                    Color.clear.overlay(alignment: .top) {
                        results.frame(height: (collapsed || detail != nil) && resultsViewportHeight > 0
                            ? resultsViewportHeight : nil)
                    }
                        .opacity(detail == nil ? contentReveal : 0)
                        .allowsHitTesting(detail == nil && expansion > 0.8)
                        .accessibilityHidden(detail != nil || expansion < 0.8)
                    if detail != nil {
                        MapActivityPager(store: store, picker: picker, expansion: expansion, compactProfile: !isSidePanel,
                                         scrollsHeading: isSidePanel, bottomContentInset: bottomInset)
                            .accessibilityHint(candidates.count > 1 ? "Swipe left or right to browse selected activities" : "")
                            .transition(.identity)
                    }
                }
                // The two-position custom panel reveals a stable viewport.
                // Relaying every drag frame into SwiftUI's lazy scroll layout
                // changes its content estimates and shifts the saved offset.
                .frame(width: viewport.size.width,
                       height: panelExpandedHeight.map { max(0, $0 + bottomInset - panelHeaderHeight) } ?? viewport.size.height,
                       alignment: .top)
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                // Hidden/zero-height viewports must not move the retained lazy list.
                if !collapsed && detail == nil && height > 0 { resultsViewportHeight = height }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .frame(height: collapsed ? 0 : nil)
            .clipped()
            .opacity(collapsed ? 0 : 1)
            .contentShape(Rectangle())
            .allowsHitTesting(!collapsed)
            .accessibilityHidden(collapsed)
        }
        // One continuous detail surface; only the outer host owns corners.
        .frame(maxHeight: .infinity, alignment: .top)
        .background { if !nativePresentation { Rectangle().fill(.regularMaterial) } }
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: isSidePanel ? 20 : 28,
            bottomLeadingRadius: 0, bottomTrailingRadius: 0,
            topTrailingRadius: isSidePanel ? 20 : 28))
        .shadow(color: .black.opacity(nativePresentation ? 0 : 0.12), radius: 16, y: 4)
        .accessibilityIdentifier("map-results-panel")
        .accessibilityAction(.escape) {
            if detail != nil { picker.showResults() }
        }
    }

    @ViewBuilder private var results: some View {
        if candidates.isEmpty {
            VStack {
                ContentUnavailableView("Selection hidden", systemImage: "line.3.horizontal.decrease.circle",
                                       description: Text("Your selected activities are hidden by filters."))
                Button("Clear filters") { store.resetFilters() }
                    .buttonStyle(.bordered).padding(.bottom, 16)
            }
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(candidates) { activity in
                        resultRow(activity)
                        if activity.id != candidates.last?.id { Divider().padding(.leading, 56) }
                    }
                }
                // Keep the final row clear of the home indicator without a
                // fixed strip masking rows as they scroll past the bottom.
                .padding(.bottom, bottomInset)
            }
            .accessibilityIdentifier("map-results-scroll")
        }
    }

    private var groupHeader: some View {
        HStack(spacing: 0) {
            SelectionBar(store: store, showsClear: false, expandsCount: true)
            Button { store.mapContext.request(detail.map { .fitActivity($0.id) } ?? .fitSelection) } label: {
                Image(systemName: "arrow.up.left.and.arrow.down.right").frame(width: 44, height: 44).contentShape(Rectangle())
            }.accessibilityLabel(detail == nil ? "Fit selection" : "Fit route")
                .accessibilityIdentifier("map-results-fit")
                .disabled(detail.map { !store.routableActivityIDs.contains($0.id) }
                    ?? !candidates.contains { store.routableActivityIDs.contains($0.id) })
            Button { store.clearSelection() } label: {
                Image(systemName: "xmark").frame(width: 44, height: 44).contentShape(Rectangle())
            }.accessibilityLabel("Clear selection")
        }.buttonStyle(.plain)
    }

    private var sidePanelHeader: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) { groupHeader; panelHandle }
            if let detail, !collapsed { resultNavigation(detail) }
        }.padding(.horizontal, 12)
    }

    private var header: some View {
        VStack(spacing: 0) {
            Color.clear.frame(height: 13).allowsHitTesting(false)
            groupHeader
            if let detail, !collapsed { resultNavigation(detail) }
        }.padding(.horizontal, 12)
    }

    private func resultNavigation(_ activity: Activity) -> some View {
        HStack(spacing: 4) {
            Button { picker.showResults() } label: {
                Label("Results", systemImage: "chevron.left").font(.subheadline.weight(.medium)).frame(minHeight: 44)
            }.accessibilityLabel("Back to selected activities").accessibilityIdentifier("map-results-back")
            Spacer(minLength: 0)
            if candidates.count > 1 { detailNavigation(activity) }
        }
    }

    private func detailNavigation(_ activity: Activity) -> some View {
        HStack(spacing: 4) {
            Button { if !picker.isPaging { picker.step(-1, store: store) } } label: {
                Image(systemName: "chevron.left").frame(width: 44, height: 44)
            }.accessibilityLabel("Previous activity")
            Text("\((picker.candidateIDs.firstIndex(of: activity.id) ?? 0) + 1) of \(candidates.count)")
                .font(.caption).monospacedDigit().foregroundStyle(AppTheme.secondaryText).fixedSize()
            Button { if !picker.isPaging { picker.step(1, store: store) } } label: {
                Image(systemName: "chevron.right").frame(width: 44, height: 44)
            }.accessibilityLabel("Next activity")
        }
        .font(.system(size: 18, weight: .semibold))
    }

    private func resultRow(_ activity: Activity) -> some View {
        HStack(spacing: 8) {
            ActivitySelectionSymbol(store: store, activity: activity)
            Button {
                picker.showDetail(activity.id, store: store)
            } label: {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        BrowseActivityHeading(activity: activity, isActive: store.activeActivityID == activity.id)
                        let metrics = typeSize.isAccessibilitySize
                            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                            : AnyLayout(HStackLayout(spacing: 8))
                        metrics {
                            BrowseInlineMetric(title: "Distance", value: Formatters.distance(activity.distance), systemImage: "ruler")
                            BrowseInlineMetric(title: "Elapsed time", value: Formatters.duration(activity.elapsedTime), systemImage: "clock")
                            BrowseInlineMetric(title: "Elevation gain", value: Formatters.elevation(activity.totalElevationGain), systemImage: "mountain.2")
                        }
                        .foregroundStyle(AppTheme.secondaryText)
                        if activity.coordinates.isEmpty {
                            Label("No GPS route", systemImage: "map.slash").font(.caption).foregroundStyle(AppTheme.secondaryText)
                        }
                        if store.activeActivityID == activity.id {
                            Label(activity.coordinates.isEmpty ? "Active activity" : "Active route", systemImage: "location.fill").font(.caption).foregroundStyle(AppTheme.accent)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }.buttonStyle(.plain)
            .accessibilityValue(store.activeActivityID == activity.id ? "Inspected. Selected. Active on map" : "Not inspected. Selected")

        }
        .padding(.leading, 12).padding(.trailing, 8).padding(.vertical, 4)
        .background(ActivityRowBackground(selected: true, inspected: store.activeActivityID == activity.id))
    }
}

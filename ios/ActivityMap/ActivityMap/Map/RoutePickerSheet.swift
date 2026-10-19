import SwiftUI

/// Persistent adaptive results surface; the map owns its position and footprint.
struct RoutePickerSheet: View {
    @Environment(\.locale) private var locale
    @Bindable var picker: RoutePicker
    @Bindable var store: ActivityStore
    let isSidePanel: Bool
    var bottomInset: CGFloat = 0
    var panelExpandedHeight: CGFloat? = nil
    var collapsedOverride: Bool? = nil
    var panelHandle: AnyView? = nil
    private var expansion: CGFloat { collapsed ? 0 : 1 }
    var nativePresentation = false
    private var collapsed: Bool { collapsedOverride ?? (picker.detent == .compact) }
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var panelHeaderHeight: CGFloat = 44
    @State private var resultsScrollID: Int?

    private var candidates: [Activity] {
        picker.candidateIDs.filter(store.visibleActivityIDs.contains).compactMap { store.activity(id: $0) }
    }
    private var detail: Activity? { candidates.first { $0.id == picker.detailID } }
    private var fitActivityID: Int? { detail?.id ?? store.activeActivityID }

    var body: some View {
        VStack(spacing: 0) {
            if isSidePanel {
                sidePanelHeader
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: {
                        if !collapsed { panelHeaderHeight = $0 }
                    }
            } else { header }
            // One native stack retains the results and owns push/Back. The
            // surrounding sheet remains the same controller during navigation.
            GeometryReader { viewport in
                MapResultsNavigation(store: store, picker: picker, detailID: detail?.id,
                    results: AnyView(results), expansion: expansion, compactProfile: !isSidePanel,
                    bottomContentInset: bottomInset,
                    allowsContinuation: !collapsed && (isSidePanel || picker.detent == .expanded))
                    // The iOS 26 custom panel still reveals a stable viewport.
                    .frame(width: viewport.size.width,
                           height: panelExpandedHeight.map { max(0, $0 + bottomInset - panelHeaderHeight) } ?? viewport.size.height,
                           alignment: .top)
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
        .background { if !nativePresentation { Rectangle().fill(.ultraThinMaterial) } }
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
                        VStack(spacing: 0) {
                            resultRow(activity)
                            if activity.id != candidates.last?.id { Divider().padding(.leading, 56) }
                        }
                        .id(activity.id)
                    }
                }
                .scrollTargetLayout()
                // Keep the final row clear of the home indicator without a
                // fixed strip masking rows as they scroll past the bottom.
                .padding(.bottom, bottomInset)
            }
            // Keep the visible activity through rotation and text reflow,
            // instead of preserving an offset based on stale lazy-row sizes.
            .scrollPosition(id: $resultsScrollID, anchor: .top)
            .scrollBounceBehavior(.basedOnSize)
            .accessibilityIdentifier("map-results-scroll")
        }
    }

    private var groupHeader: some View {
        HStack(spacing: 0) {
            if let detail {
                Button { picker.showResults() } label: {
                    BrowseActionIcon(.back).frame(width: 44, height: 44).contentShape(Rectangle())
                }
                .accessibilityLabel("Back to selected activities")
                .accessibilityIdentifier("map-results-back")
                let sequence = ActivityDetailSequence(ids: picker.candidateIDs, currentID: detail.id)
                Text(sequence.position ?? "1 of 1")
                    .font(.caption).foregroundStyle(AppTheme.secondaryText)
                    .lineLimit(1).minimumScaleFactor(0.8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if picker.candidateIDs.count > 1 {
                    ActivityDetailStepButtons(
                        previous: sequence.previousID == nil ? nil : { picker.step(-1, store: store) },
                        next: sequence.nextID == nil ? nil : { picker.step(1, store: store) })
                        .disabled(picker.isPaging)
                }
            } else {
                SelectionBar(store: store, showsClear: false, expandsCount: true)
            }
            Button { store.mapContext.request(fitActivityID.map { .fitActivity($0) } ?? .fitSelection) } label: {
                Image(systemName: "viewfinder").frame(width: 44, height: 44).contentShape(Rectangle())
            }.accessibilityLabel(fitActivityID == nil ? "Fit selection" : "Fit route")
                .accessibilityIdentifier("map-results-fit")
                .disabled(fitActivityID.map { !store.routableActivityIDs.contains($0) }
                    ?? !candidates.contains { store.routableActivityIDs.contains($0.id) })
            // Detail owns its single-activity share action in the footer.
            if detail == nil { MapActivityShareButton(picker: picker, store: store) }
            Button { store.clearSelection() } label: {
                Image(systemName: "xmark").frame(width: 44, height: 44).contentShape(Rectangle())
            }.accessibilityLabel("Clear selection")
        }.buttonStyle(.plain)
    }

    private var sidePanelHeader: some View {
        HStack(spacing: 0) { groupHeader; panelHandle }
            .padding(.horizontal, 12)
    }

    private var header: some View {
        VStack(spacing: 0) {
            Color.clear.frame(height: 13).allowsHitTesting(false)
            groupHeader
        }.padding(.horizontal, 12)
    }

    private func resultRow(_ activity: Activity) -> some View {
        let isActive = store.activeActivityID == activity.id
        return HStack(spacing: 0) {
            ActivitySelectionSymbol(store: store, activity: activity)
            Button {
                picker.showDetail(activity.id, store: store)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    BrowseActivityHeading(activity: activity)
                    ActivityMetricFlow(spacing: 8, rowSpacing: 4, stacked: typeSize.isAccessibilitySize) {
                        BrowseInlineMetric(title: "Distance", value: Formatters.distance(activity.distance), systemImage: "ruler")
                        BrowseInlineMetric(title: "Elapsed time", value: Formatters.duration(activity.elapsedTime), systemImage: "clock")
                        BrowseInlineMetric(title: "Elevation gain", value: Formatters.elevation(activity.totalElevationGain), systemImage: "mountain.2")
                    }
                    .foregroundStyle(AppTheme.secondaryText)
                    if activity.coordinates.isEmpty {
                        Label("No GPS route", systemImage: "map.slash").font(.caption).foregroundStyle(AppTheme.secondaryText)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }.buttonStyle(.plain)
                .padding(.leading, 8)
                .padding(.trailing, 4)
                .accessibilityLabel("Details for \(activity.name)")
                .accessibilityValue(Text(isActive ? AppMessages.stateSelectedActiveRoute(locale: locale) : AppMessages.selectionSelected(locale: locale)))
                .accessibilityHint("Activates this activity and opens its details without changing selection")
                .accessibilityIdentifier("map-result-open-\(activity.id)")
                .modifier(ActivityRowContextMenu(activity: activity, store: store))
            Button { store.toggleActive(activity.id) } label: {
                Image(systemName: ActiveRoutePresentation.glyph(active: isActive, variant: .toggle))
                    .font(.system(size: 18, weight: isActive ? .semibold : .regular))
                    .foregroundStyle(isActive ? AppTheme.accent : AppTheme.secondaryText)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(isActive ? AppMessages.actionDeactivateActivity(activity.name, locale: locale) : AppMessages.actionActivateActivity(activity.name, locale: locale)))
            .accessibilityValue(Text(ActiveRoutePresentation.state(isActive, locale: locale)))
            .accessibilityHint(Text(isActive ? AppMessages.actionDeactivateHint(locale: locale) : AppMessages.actionActivateHint(locale: locale)))
            .accessibilityAddTraits(isActive ? .isSelected : [])
            .accessibilityIdentifier("map-result-activate-\(activity.id)")
        }
        .padding(.leading, 12).padding(.trailing, 8).padding(.vertical, 4)
        .background(ActivityRowBackground(selected: true, inspected: store.activeActivityID == activity.id, overMap: true))
    }
}

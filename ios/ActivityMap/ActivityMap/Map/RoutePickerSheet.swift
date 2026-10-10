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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var panelHeaderHeight: CGFloat = 44

    private var candidates: [Activity] {
        picker.candidateIDs.filter(store.visibleActivityIDs.contains).compactMap { store.activity(id: $0) }
    }
    private var detail: Activity? { candidates.first { $0.id == picker.detailID } }

    private var singleDetail: Bool { detail != nil && candidates.count == 1 }
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
                    results
                        .opacity(detail == nil ? contentReveal : 0)
                        .allowsHitTesting(detail == nil && expansion > 0.8)
                        .accessibilityHidden(detail != nil || expansion < 0.8)
                    if detail != nil {
                        MapActivityPager(store: store, picker: picker, expansion: expansion, compactProfile: !isSidePanel,
                                         scrollsHeading: isSidePanel, bottomContentInset: bottomInset)
                            .accessibilityHint(candidates.count > 1 ? "Swipe left or right to browse selected activities" : "")
                            .transition(.opacity)
                    }
                }
                // The two-position custom panel reveals a stable viewport.
                // Relaying every drag frame into SwiftUI's lazy scroll layout
                // changes its content estimates and shifts the saved offset.
                .frame(width: viewport.size.width,
                       height: panelExpandedHeight.map { max(0, $0 + bottomInset - panelHeaderHeight) } ?? viewport.size.height,
                       alignment: .top)
                .animation(reduceMotion ? nil : .easeInOut(duration: 0.18), value: detail != nil)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .frame(height: collapsed && (isSidePanel || detail == nil) ? 0 : nil)
            .clipped()
            .opacity(isSidePanel && collapsed ? 0 : 1)
            .contentShape(Rectangle())
            .allowsHitTesting(!isSidePanel || !collapsed)
            .accessibilityHidden(collapsed && (isSidePanel || detail == nil))
        }
        // One continuous detail surface; only the outer host owns corners.
        .frame(maxHeight: .infinity, alignment: .top)
        .background { if !nativePresentation { Rectangle().fill(.regularMaterial) } }
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: isSidePanel ? 20 : 28,
            bottomLeadingRadius: 0, bottomTrailingRadius: 0,
            topTrailingRadius: isSidePanel ? 20 : 28))
        .shadow(color: .black.opacity(nativePresentation ? 0 : 0.12), radius: 16, y: 4)
        .accessibilityIdentifier("map-results-panel")
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

    private var sidePanelHeader: some View {
        HStack(spacing: 4) {
            if detail != nil && candidates.count > 1 && !collapsed {
                Button { picker.showResults() } label: {
                    Image(systemName: "chevron.left").frame(width: 44, height: 44)
                }
                .accessibilityLabel("Back to selected activities")
                .accessibilityIdentifier("map-results-back")
            }
            if collapsed, let detail {
                ActivityDetailIdentity(activity: detail, titleLineLimit: 1)
            } else if detail == nil {
                selectionSummary
            }
            if detail != nil && !collapsed {
                Spacer(minLength: 0)
            }
            if detail != nil && !collapsed {
                if candidates.count > 1, let detail { detailNavigation(detail) }
            }
            if detail == nil {
                selectionActions
                    .opacity(collapsed ? 0 : 1)
                    .allowsHitTesting(!collapsed)
                    .accessibilityHidden(collapsed)
            }
            // Always the trailing control, regardless of summary/navigation.
            panelHandle
        }
        // The collapsed identity aligns with portrait detail; the trailing
        // handle keeps its inset so it stays under the same finger.
        .padding(.leading, collapsed && detail != nil ? AppTheme.Spacing.large : 12)
        .padding(.trailing, 12)
        .padding(.vertical, collapsed && detail != nil ? AppTheme.Spacing.small : 0)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var header: some View {
        VStack(spacing: 0) {
            // Visual grabber clearance only. The 44pt native touch target
            // overlays the surface instead of reserving an empty row.
            Color.clear.frame(height: 13).allowsHitTesting(false)
            if !singleDetail && !(collapsed && detail != nil) {
                let layout = typeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 0))
                    : AnyLayout(HStackLayout(spacing: 4))
                layout {
                    if let activity = detail {
                        if candidates.count > 1 {
                            Button { picker.showResults() } label: {
                                Label("Results", systemImage: "chevron.left")
                                    .font(.subheadline.weight(.medium))
                                    .frame(minHeight: 44)
                            }
                            .accessibilityLabel("Back to selected activities")
                            .accessibilityIdentifier("map-results-back")
                        }
                        if !typeSize.isAccessibilitySize { Spacer(minLength: 0) }
                        if candidates.count > 1 { detailNavigation(activity) }
                    } else {
                        selectionSummary
                    }
                    if detail == nil { selectionActions }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }
        }
    }

    private var selectionSummary: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(store.selectedActivityIDs.count) selected").font(.headline)
            if store.hiddenSelectedCount > 0 {
                Text("\(store.hiddenSelectedCount) hidden by filters").font(.caption).foregroundStyle(AppTheme.secondaryText)
            } else if picker.isAdding {
                Text("Tap routes to add").font(.caption).foregroundStyle(AppTheme.secondaryText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var selectionActions: some View {
        Menu {
            if let activity = detail {
                Section(activity.name) {
                    Button("Frame route", systemImage: "map") {
                        store.showOnMap(activity.id)
                    }.disabled(activity.coordinates.isEmpty)
                    Button("Deselect activity", systemImage: "minus.circle") { store.removeFromSelection([activity.id]) }
                }
            }
            Toggle("Add routes to selection", systemImage: "plus", isOn: $picker.isAdding)
            Button("Fit selection", systemImage: "arrow.up.left.and.arrow.down.right") {
                store.mapContext.request(.fitSelection)
            }
            .disabled(!candidates.contains { !$0.coordinates.isEmpty })
            Button("Clear selection", systemImage: "xmark.circle", role: .destructive) { store.clearSelection() }
        } label: {
            BrowseIconLabel(systemImage: "ellipsis")
        }
        .accessibilityLabel("Selection actions")
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
            Button { store.toggleSelection(activity.id) } label: {
                BrowseSportSymbol(category: activity.category, isSelected: store.selectedActivityIDs.contains(activity.id))
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Deselect \(activity.name)")
            .accessibilityValue("Selected")
            .accessibilityAddTraits(.isSelected)
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

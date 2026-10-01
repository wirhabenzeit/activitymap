import SwiftUI

/// Persistent adaptive results surface; the map owns its position and footprint.
struct RoutePickerSheet: View {
    @Bindable var picker: RoutePicker
    @Bindable var store: ActivityStore
    let isSidePanel: Bool
    var bottomInset: CGFloat = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize

    private var candidates: [Activity] {
        let byID = Dictionary(uniqueKeysWithValues: store.filteredActivities.map { ($0.id, $0) })
        return picker.candidateIDs.compactMap { byID[$0] }
    }
    private var detail: Activity? { candidates.first { $0.id == picker.detailID } }

    private var singleDetail: Bool { detail != nil && candidates.count == 1 && picker.detent != .compact }
    var body: some View {
        VStack(spacing: 0) {
            header
            if picker.detent == .compact { compactSummary }
            // Keep results mounted through detail and detent changes. Back
            // restores the exact scroll position, without a second overlay.
            ZStack {
                results
                    .opacity(detail == nil ? 1 : 0)
                    .allowsHitTesting(detail == nil)
                    .accessibilityHidden(detail != nil)
                if detail != nil {
                    MapActivityPager(store: store, picker: picker, singleDetail: singleDetail)
                        .overlay(alignment: .topTrailing) {
                            if singleDetail { collapseButton.padding(.trailing, 16).padding(.top, 4) }
                        }
                        .accessibilityHint(candidates.count > 1 ? "Swipe left or right to browse selected activities" : "")
                        .transition(reduceMotion ? .opacity : .move(edge: .trailing))
                }
            }
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.18), value: detail != nil)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .frame(height: picker.detent == .compact ? 0 : nil)
            .clipped()
            .accessibilityHidden(picker.detent == .compact)
        }
        // One continuous detail surface; only the outer host owns corners.
        .padding(.bottom, bottomInset)
        .background(.regularMaterial)
        .clipShape(UnevenRoundedRectangle(topLeadingRadius: isSidePanel ? 20 : 28,
            bottomLeadingRadius: isSidePanel ? 20 : 0, bottomTrailingRadius: isSidePanel ? 20 : 0,
            topTrailingRadius: isSidePanel ? 20 : 28))
        .shadow(color: .black.opacity(0.12), radius: 16, y: 4)
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
            }
            .accessibilityIdentifier("map-results-scroll")
        }
    }

    private var header: some View {
        VStack(spacing: 0) {
            if !isSidePanel {
                Capsule().fill(.secondary.opacity(0.4)).frame(width: 32, height: 4).padding(.top, 9)
            }
            if !singleDetail {
                let layout = typeSize.isAccessibilitySize
                    ? AnyLayout(VStackLayout(alignment: .leading, spacing: 0))
                    : AnyLayout(HStackLayout(spacing: 4))
                layout {
                    if let activity = detail, picker.detent != .compact {
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
                    HStack(spacing: 4) {
                        if detail == nil || picker.detent == .compact { selectionActions }
                        collapseButton
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
            }
        }
        .contentShape(Rectangle())
        // Header drag resizes this one container; content scrolling never does.
        .simultaneousGesture(DragGesture(minimumDistance: 24).onEnded { drag in
            guard abs(drag.translation.height) > abs(drag.translation.width) * 1.5 else { return }
            let change = drag.translation.height < -30 ? 1 : drag.translation.height > 30 ? -1 : 0
            resize(to: MapResultsDetent(rawValue: min(2, max(0, picker.detent.rawValue + change))) ?? .medium)
        })
        .accessibilityAdjustableAction { direction in
            let change = direction == .increment ? 1 : -1
            resize(to: MapResultsDetent(rawValue: min(2, max(0, picker.detent.rawValue + change))) ?? .medium)
        }
        .accessibilityAction(named: "Expand results fully") { resize(to: .expanded) }
    }

    private var collapseButton: some View {
        Button { resize(to: picker.detent == .compact ? .medium : .compact) } label: {
            Image(systemName: picker.detent == .compact ? "chevron.up" : "chevron.down")
                .font(.system(size: 18, weight: .semibold)).frame(width: 44, height: 44)
        }
        .accessibilityLabel(picker.detent == .compact ? "Expand results" : "Collapse results")
    }

    private func resize(to detent: MapResultsDetent) {
        withAnimation(reduceMotion ? nil : .snappy) { picker.detent = detent }
    }

    private var selectionSummary: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(store.selectedActivityIDs.count) selected").font(.headline)
            if store.hiddenSelectedCount > 0 {
                Text("\(store.hiddenSelectedCount) hidden by filters").font(.caption).foregroundStyle(.secondary)
            } else if picker.isAdding {
                Text("Tap routes to add").font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var selectionActions: some View {
        Menu {
            if let activity = detail {
                Section(activity.name) {
                    Button("Frame route", systemImage: "scope") {
                        picker.detent = .compact
                        store.showOnMap(activity.id)
                    }.disabled(activity.coordinates.isEmpty)
                    Button("Deselect activity", systemImage: "minus.circle") { store.removeFromSelection([activity.id]) }
                }
            }
            Toggle("Add routes to selection", isOn: $picker.isAdding)
            Button("Fit selection", systemImage: "scope") {
                picker.detent = .compact
                store.mapContext.request(.fitSelection)
            }
            .disabled(!candidates.contains { !$0.coordinates.isEmpty })
            Button("Expand results fully", systemImage: "arrow.up.left.and.arrow.down.right") { resize(to: .expanded) }
            Button("Clear selection", systemImage: "xmark.circle", role: .destructive) { store.clearSelection() }
            Button("Hide results", systemImage: "eye.slash") { picker.isPresented = false }
        } label: {
            BrowseIconLabel(systemImage: "ellipsis")
        }
        .accessibilityLabel("Selection actions")
    }

    private var compactSummary: some View {
        Button {
            resize(to: .medium)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                if let activity = detail ?? (candidates.count == 1 ? candidates.first : nil) {
                    Text(activity.name).font(.subheadline.weight(.semibold)).lineLimit(2)
                    Text("\(Formatters.distance(activity.distance))  ·  \(Formatters.duration(activity.elapsedTime))  ·  \(Formatters.elevation(activity.totalElevationGain)) ↑")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                } else {
                    Text(candidates.isEmpty ? "Hidden by filters" : "\(candidates.count) activities to explore")
                        .font(.subheadline.weight(.semibold))
                    Text("Expand to review your selection").font(.caption).foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.horizontal, 20).padding(.bottom, 16)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func detailNavigation(_ activity: Activity) -> some View {
        HStack(spacing: 4) {
            Button { picker.step(-1, store: store) } label: {
                Image(systemName: "chevron.left").frame(width: 44, height: 44)
            }.disabled(picker.isPaging).accessibilityLabel("Previous activity")
            Text("\((picker.candidateIDs.firstIndex(of: activity.id) ?? 0) + 1) of \(candidates.count)")
                .font(.caption).monospacedDigit().foregroundStyle(.secondary).fixedSize()
            Button { picker.step(1, store: store) } label: {
                Image(systemName: "chevron.right").frame(width: 44, height: 44)
            }.disabled(picker.isPaging).accessibilityLabel("Next activity")
        }
        .font(.system(size: 18, weight: .semibold))
    }

    private func resultRow(_ activity: Activity) -> some View {
        HStack(spacing: 8) {
            Button {
                picker.showDetail(activity.id, store: store)
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: activity.category.symbolName)
                        .foregroundStyle(activity.category.color).frame(width: 24)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(activity.name).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                        Text(Formatters.shortDate(activity.startDateLocal, timeZone: .gmt))
                            .font(.caption).foregroundStyle(.secondary)
                        Text("\(Formatters.distance(activity.distance)) · \(Formatters.duration(activity.elapsedTime))")
                            .font(.caption).foregroundStyle(.secondary)
                        if activity.coordinates.isEmpty {
                            Label("No GPS route", systemImage: "map.slash").font(.caption).foregroundStyle(.secondary)
                        }
                        if store.activeActivityID == activity.id {
                            Label(activity.coordinates.isEmpty ? "Active activity" : "Active route", systemImage: "location.fill").font(.caption).foregroundStyle(.blue)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(minHeight: 60)
                .contentShape(Rectangle())
            }.buttonStyle(.plain)
            Button { store.removeFromSelection([activity.id]) } label: {
                Image(systemName: "minus.circle").foregroundStyle(.secondary).frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Deselect \(activity.name)")
        }
        .padding(.leading, 20).padding(.trailing, 8).padding(.vertical, 12)
        .background(store.activeActivityID == activity.id ? Color.blue.opacity(0.06) : .clear)
    }
}

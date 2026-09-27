import SwiftUI

/// Persistent adaptive results surface; the map owns its position and footprint.
struct RoutePickerSheet: View {
    @Bindable var picker: RoutePicker
    @Bindable var store: ActivityStore
    let isSidePanel: Bool

    private var candidates: [Activity] {
        let byID = Dictionary(uniqueKeysWithValues: store.filteredActivities.map { ($0.id, $0) })
        return picker.candidateIDs.compactMap { byID[$0] }
    }
    private var detail: Activity? { candidates.first { $0.id == picker.detailID } }

    var body: some View {
        VStack(spacing: 0) {
            header
            if picker.detent == .compact {
                compactSummary
            } else if let activity = detail {
                if candidates.count > 1 { detailNavigation(activity) }
                if activity.coordinates.isEmpty {
                    Label("No GPS route recorded", systemImage: "map.slash")
                        .font(.caption).foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20)
                }
                ScrollView {
                    ActivityDetailContent(activity: activity)
                }
                .id(activity.id)
            } else if candidates.isEmpty {
                ContentUnavailableView("Selection hidden", systemImage: "line.3.horizontal.decrease.circle",
                                       description: Text("Your selected activities are hidden by filters."))
                Button("Clear filters") { store.resetFilters() }
                    .buttonStyle(.bordered).padding(.bottom, 16)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(candidates) { activity in
                            resultRow(activity)
                            if activity.id != candidates.last?.id { Divider().padding(.leading, 56) }
                        }
                    }
                }
            }
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24))
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(.primary.opacity(0.08)))
        .shadow(color: .black.opacity(0.12), radius: 16, y: 4)
        .accessibilityIdentifier("map-results-panel")
    }

    private var header: some View {
        VStack(spacing: 0) {
            Capsule().fill(.secondary.opacity(0.4)).frame(width: 32, height: 4).padding(.top, 9)
                .opacity(isSidePanel ? 0 : 1)
            HStack(spacing: 4) {
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
                    Button("Clear selection", systemImage: "xmark.circle", role: .destructive) { store.clearSelection() }
                    Button("Hide results", systemImage: "eye.slash") { picker.isPresented = false }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 18, weight: .semibold)).frame(width: 44, height: 44)
                }
                .accessibilityLabel("Selection actions")
                Button {
                    withAnimation(.snappy) { picker.detent = picker.detent == .compact ? .medium : .compact }
                } label: {
                    Image(systemName: picker.detent == .compact ? "chevron.up" : "chevron.down")
                        .font(.system(size: 18, weight: .semibold)).frame(width: 44, height: 44)
                }
                .accessibilityLabel(picker.detent == .compact ? "Expand results" : "Collapse results")
                if picker.detent != .compact {
                    Button {
                        withAnimation(.snappy) { picker.detent = picker.detent == .expanded ? .medium : .expanded }
                    } label: {
                        Image(systemName: picker.detent == .expanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
                            .font(.system(size: 18, weight: .semibold)).frame(width: 44, height: 44)
                    }
                    .accessibilityLabel(picker.detent == .expanded ? "Medium results" : "Expand results fully")
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
        }
        .contentShape(Rectangle())
        // Only the header drags; scrolling content never selects a route or resizes the panel.
        .simultaneousGesture(DragGesture(minimumDistance: 24).onEnded { drag in
            let change = drag.translation.height < -30 ? 1 : drag.translation.height > 30 ? -1 : 0
            withAnimation(.snappy) {
                picker.detent = MapResultsDetent(rawValue: min(2, max(0, picker.detent.rawValue + change))) ?? .medium
            }
        })
        .accessibilityAdjustableAction { direction in
            let change = direction == .increment ? 1 : -1
            picker.detent = MapResultsDetent(rawValue: min(2, max(0, picker.detent.rawValue + change))) ?? .medium
        }
    }

    private var compactSummary: some View {
        Button {
            withAnimation(.snappy) { picker.detent = .medium }
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
            Button { picker.detailID = nil } label: {
                Image(systemName: "list.bullet").frame(width: 44, height: 44)
            }.accessibilityLabel("All selected activities")
            Spacer(minLength: 0)
            Button { picker.step(-1, store: store) } label: {
                Image(systemName: "chevron.left").frame(width: 44, height: 44)
            }.accessibilityLabel("Previous activity")
            Text("\((picker.candidateIDs.firstIndex(of: activity.id) ?? 0) + 1) of \(candidates.count)")
                .font(.caption).monospacedDigit().foregroundStyle(.secondary)
            Button { picker.step(1, store: store) } label: {
                Image(systemName: "chevron.right").frame(width: 44, height: 44)
            }.accessibilityLabel("Next activity")
        }
        .font(.system(size: 18, weight: .semibold))
        .padding(.horizontal, 16)
        .overlay(alignment: .bottom) { Divider() }
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

import SwiftUI

struct ActivityDetailActions: View {
    let activity: Activity
    var summaries: StreamSummaryLoader? = nil
    @Environment(\.activityDetailOverMap) private var overMap
    @State private var exportTask: Task<Void, Never>?
    @State private var stravaTask: Task<Void, Never>?
    @State private var file: ActivityGPXFile?
    @State private var openingStrava = false
    @State private var failure: Failure?
    @State private var decodedElevation: DecodedElevation?

    private struct DecodedElevation {
        let cached: CachedStreamSummary
        let elevation: ActivityGPX.SampledElevation?
    }

    private struct Failure: Identifiable {
        let id = UUID()
        let title: String
        let message: String
    }

    private var cached: CachedStreamSummary? { summaries?.currentSummary(for: String(activity.id)) }
    private var elevation: ActivityGPX.SampledElevation? {
        decodedElevation?.cached == cached ? decodedElevation?.elevation : nil
    }
    private var hasGeometry: Bool { !activity.coordinates.isEmpty || elevation != nil }
    private var quality: String {
        elevation != nil ? "Sampled route with elevation" : activity.geometrySource == .detailed ? "Detailed route" : "Simplified route"
    }
    private var exportSubtitle: String {
        hasGeometry ? "\(quality) · available offline" : "Unavailable · no GPS route"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(spacing: 0) {
                Button(action: openStrava) {
                    row(title: openingStrava ? "Opening Strava…" : "Open in Strava",
                        subtitle: "View the original activity", icon: "arrow.up.right.square",
                        trailing: "arrow.up.right", busy: openingStrava)
                }
                .disabled(openingStrava)
                .accessibilityIdentifier("activity-open-in-strava")
                Divider().padding(.leading, 44)
                Button(action: exportGPX) {
                    row(title: exportTask == nil ? "Export GPX" : "Preparing GPX…",
                        subtitle: exportSubtitle, icon: "doc.badge.arrow.up",
                        trailing: "square.and.arrow.up", busy: exportTask != nil)
                }
                .disabled(!hasGeometry || exportTask != nil || file != nil)
                .opacity(hasGeometry ? 1 : 0.5)
                .accessibilityIdentifier("activity-export-gpx")
                .accessibilityHint(hasGeometry ? "Share the saved route as a GPX file" : "This activity has no GPS route to export")
                .background(ActivityGPXSharePresenter(file: $file) { error in
                    failure = Failure(title: "Couldn’t share GPX", message: error.localizedDescription)
                })
            }
            .buttonStyle(.plain)
            .background {
                if !overMap {
                    RoundedRectangle(cornerRadius: 12).fill(AppTheme.contentBackground)
                }
            }
        }
        .alert(item: $failure) { failure in
            Alert(title: Text(failure.title), message: Text(failure.message), dismissButton: .default(Text("OK")))
        }
        .task(id: cached) {
            guard let cached else { decodedElevation = nil; return }
            let id = activity.id
            let worker = Task.detached(priority: .userInitiated) { ActivityGPX.SampledElevation.decode(cached, activityID: id) }
            let elevation = await withTaskCancellationHandler { await worker.value } onCancel: { worker.cancel() }
            guard !Task.isCancelled, self.cached == cached else { return }
            decodedElevation = DecodedElevation(cached: cached, elevation: elevation)
        }
        .onDisappear {
            exportTask?.cancel()
            stravaTask?.cancel()
            file = nil
        }
    }

    private func row(title: String, subtitle: String, icon: String, trailing: String, busy: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(AppTheme.Typography.icon).foregroundStyle(AppTheme.accent).frame(width: 22)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                Text(subtitle).font(.caption).foregroundStyle(AppTheme.secondaryText)
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            if busy { ProgressView().accessibilityLabel(title) }
            else { Image(systemName: trailing).font(AppTheme.Typography.icon).foregroundStyle(AppTheme.secondaryText).accessibilityHidden(true) }
        }
        .padding(12)
        .frame(minHeight: AppTheme.minimumTarget)
        .contentShape(Rectangle())
    }

    private func openStrava() {
        guard !openingStrava else { return }
        openingStrava = true
        let id = activity.id
        stravaTask = Task {
            defer { openingStrava = false; stravaTask = nil }
            do { try await StravaActivityLink.open(activityID: id) }
            catch is CancellationError { }
            catch { if !Task.isCancelled { failure = Failure(title: "Couldn’t open Strava", message: error.localizedDescription) } }
        }
    }

    private func exportGPX() {
        guard hasGeometry, exportTask == nil, file == nil else { return }
        let snapshot = ActivityGPX(activity: activity)
        let source = cached
        exportTask = Task {
            defer { exportTask = nil }
            let worker = Task.detached(priority: .userInitiated) {
                try snapshot.includingSampledElevation(from: source).write()
            }
            do {
                let result = try await withTaskCancellationHandler { try await worker.value } onCancel: { worker.cancel() }
                try Task.checkCancellation()
                guard source == cached else { return }
                file = result
            } catch is CancellationError { }
            catch {
                if !Task.isCancelled {
                    let message = (error as? ActivityGPX.ExportError)?.localizedDescription ?? "The GPX file couldn’t be created. Please try again."
                    failure = Failure(title: "Couldn’t export GPX", message: message)
                }
            }
        }
    }
}

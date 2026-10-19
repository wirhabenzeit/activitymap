import SwiftUI

struct ActivityDetailActions: View {
    @Environment(\.locale) private var locale
    let activity: Activity
    var summaries: StreamSummaryLoader? = nil
    @Environment(\.activityDetailOverMap) private var overMap
    var exportStore: ActivityStore? = nil
    @State private var workflow = ActivityGPXExportController()
    @State private var stravaTask: Task<Void, Never>?
    @State private var openingStrava = false
    private var source: ActivityGPXExportSource {
        .capture(activity: activity, store: exportStore, summaries: summaries)
    }

    private var key: ActivityGPXExportKey { .init(activity: activity, store: exportStore, summaries: summaries) }
    private var availability: ActivityGPXExportAvailability {
        workflow.prepared(for: key) ?? .preflight(activity: activity,
            summary: (exportStore?.streamSummaries ?? summaries)?.currentSummary(for: String(activity.id)))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(spacing: 0) {
                ActivityShareButton(activities: { [activity] }) {
                    row(title: Text("Share activity"), subtitle: "Create an expiring link to its map", icon: "square.and.arrow.up",
                        trailing: "chevron.right", busy: false)
                }
                .accessibilityIdentifier("activity-share")
                Divider().padding(.leading, 44)
                Button(action: openStrava) {
                    row(title: openingStrava ? Text("Opening Strava…") : Text("Open in Strava"),
                        subtitle: "View the original activity", icon: "arrow.up.right.square",
                        trailing: "arrow.up.right", busy: openingStrava)
                }
                .disabled(openingStrava)
                .accessibilityIdentifier("activity-open-in-strava")
                Divider().padding(.leading, 44)
                Button(action: { workflow.export(source: source, current: { source }) }) {
                    row(title: Text(workflow.isExporting ? AppMessages.actionPreparingGPX(locale: locale) : AppMessages.actionExportGPXNative(locale: locale)),
                        subtitle: availability.subtitle, icon: ActionPresentation.glyph(.exportGPX),
                        trailing: "square.and.arrow.up", busy: workflow.isExporting)
                }
                .disabled(!availability.canExport || workflow.isExporting || workflow.file != nil)
                .opacity(availability.canExport ? 1 : 0.5)
                .accessibilityIdentifier("activity-export-gpx")
                .accessibilityHint(availability.hint)
                .background(ActivityGPXSharePresenter(file: $workflow.file) { error in
                    workflow.report(title: "Couldn’t share GPX", message: error.localizedDescription)
                })
            }
            .buttonStyle(.plain)
            .background {
                if !overMap {
                    RoundedRectangle(cornerRadius: 12).fill(AppTheme.contentBackground)
                }
            }
        }
        .alert(item: $workflow.failure) { failure in
            Alert(title: Text(failure.title), message: Text(failure.message), dismissButton: .default(Text("OK")))
        }
        .task(id: key) { await workflow.prepare(source, key: key, current: { self.source }) }
        .onDisappear {
            workflow.cancel()
            stravaTask?.cancel()
        }
    }

    private func row(title: Text, subtitle: String, icon: String, trailing: String, busy: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(AppTheme.Typography.icon).foregroundStyle(AppTheme.accent).frame(width: 22)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                title.font(.subheadline.weight(.medium)).foregroundStyle(.primary)
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
            catch { if !Task.isCancelled { workflow.report(title: "Couldn’t open Strava", message: error.localizedDescription) } }
        }
    }

}

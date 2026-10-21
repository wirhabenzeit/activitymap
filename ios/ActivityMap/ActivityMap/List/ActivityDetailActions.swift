import SwiftUI

struct ActivityDetailActions: View {
    @Environment(\.locale) private var locale
    let activity: Activity
    var hasRoute = true
    var showOnMap: ((Int) -> Void)? = nil
    var editing: ActivityEditingService? = nil
    var summaries: StreamSummaryLoader? = nil
    @Environment(\.activityDetailOverMap) private var overMap
    @Environment(\.editActivityRow) private var editActivity
    var exportStore: ActivityStore? = nil
    @State private var workflow = ActivityGPXExportController()
    @State private var stravaTask: Task<Void, Never>?
    @State private var openingStrava = false
    @State private var isEditing = false
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
                if let editing {
                    Button {
                        // A save can filter this detail out and pop its page.
                        // Keep the editor on the browsing screen in that case.
                        if let editActivity { editActivity(activity) }
                        else { isEditing = true }
                    } label: {
                        row(title: Text(AppMessages.activityEditTitle(locale: locale)), subtitle: Text(AppMessages.activityEditSubtitle(locale: locale)), icon: ActionPresentation.glyph(.edit),
                            trailing: "chevron.right", busy: false)
                    }
                    .accessibilityLabel(Text(AppMessages.activityEditTitle(locale: locale)))
                    .accessibilityIdentifier("activity-edit-action")
                    .sheet(isPresented: $isEditing) {
                        ActivityEditForm(activity: activity, service: editing)
                    }
                    Divider().padding(.leading, 44)
                }
                if let showOnMap, !overMap {
                    Button { showOnMap(activity.id) } label: {
                        row(title: Text(AppMessages.actionShowOnMap(locale: locale)),
                            subtitle: Text(hasRoute ? AppMessages.activityActionShowOnMapHint(locale: locale) : AppMessages.activityActionNoRoute(locale: locale)),
                            icon: ActionPresentation.glyph(.showOnMap), trailing: "arrow.up.right", busy: false)
                    }
                    .disabled(!hasRoute)
                    .opacity(hasRoute ? 1 : 0.5)
                    .accessibilityLabel(Text(AppMessages.actionShowOnMap(locale: locale)))
                    .accessibilityIdentifier("activity-show-on-map")
                    .accessibilityHint(Text(hasRoute ? AppMessages.activityActionShowOnMapHint(locale: locale) : AppMessages.activityActionNoRoute(locale: locale)))
                    Divider().padding(.leading, 44)
                }
                ActivityShareButton(activities: { [activity] }) {
                    row(title: Text(AppMessages.actionShareActivity(locale: locale)), subtitle: Text(AppMessages.activityActionShareHint(locale: locale)), icon: ActionPresentation.glyph(.shareActivity),
                        trailing: "chevron.right", busy: false)
                }
                .accessibilityIdentifier("activity-share")
                Divider().padding(.leading, 44)
                Button(action: openStrava) {
                    row(title: Text(openingStrava ? AppMessages.actionOpeningStrava(locale: locale) : AppMessages.actionOpenInStrava(locale: locale)),
                        subtitle: Text(AppMessages.activityActionStravaHint(locale: locale)), icon: ActionPresentation.glyph(.openInStrava),
                        trailing: "arrow.up.right", busy: openingStrava)
                }
                .disabled(openingStrava)
                .accessibilityIdentifier("activity-open-in-strava")
                Divider().padding(.leading, 44)
                Button(action: { workflow.export(source: source, current: { source }) }) {
                    row(title: Text(workflow.isExporting ? AppMessages.actionPreparingGPX(locale: locale) : AppMessages.actionExportGPXNative(locale: locale)),
                        subtitle: Text(availability.subtitleResource(locale: locale)), icon: ActionPresentation.glyph(.exportGPX),
                        trailing: "square.and.arrow.up", busy: workflow.isExporting)
                }
                .disabled(!availability.canExport || workflow.isExporting || workflow.file != nil)
                .opacity(availability.canExport ? 1 : 0.5)
                .accessibilityIdentifier("activity-export-gpx")
                .accessibilityHint(Text(availability.hintResource(locale: locale)))
                .background(ActivityGPXSharePresenter(file: $workflow.file) { error in
                    workflow.report(title: String(localized: AppMessages.activityActionShareGPXFailed(locale: locale)), message: error.localizedDescription)
                })
            }
            .buttonStyle(.plain)
            .background {
                if !overMap {
                    RoundedRectangle(cornerRadius: 12).fill(AppTheme.contentBackground)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("activity-detail-actions")
        .alert(item: $workflow.failure) { failure in
            Alert(title: Text(failure.title), message: Text(failure.message), dismissButton: .default(Text(AppMessages.actionOk(locale: locale))))
        }
        .task(id: key) { await workflow.prepare(source, key: key, current: { self.source }) }
        .onDisappear {
            workflow.cancel()
            stravaTask?.cancel()
        }
    }

    private func row(title: Text, subtitle: Text, icon: String, trailing: String, busy: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(AppTheme.Typography.icon).foregroundStyle(AppTheme.accent).frame(width: 22)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                title.font(.subheadline.weight(.medium)).foregroundStyle(.primary)
                subtitle.font(.caption).foregroundStyle(AppTheme.secondaryText)
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
            catch { if !Task.isCancelled { workflow.report(title: String(localized: AppMessages.activityActionOpenFailed(locale: locale)), message: error.localizedDescription) } }
        }
    }

}

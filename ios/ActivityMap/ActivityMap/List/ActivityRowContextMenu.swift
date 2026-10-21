import SwiftUI

extension EnvironmentValues {
    @Entry var editActivityRow: ((Activity) -> Void)? = nil
}

/// An editor outlives lazy rows and native context-menu presentation updates.
/// Each browsing screen owns its draft destination outside the scrolling rows.
struct ActivityRowEditorPresenter: ViewModifier {
    let store: ActivityStore
    @State private var editingActivity: Activity?

    func body(content: Content) -> some View {
        content
            .environment(\.editActivityRow, { activity in
                guard store.activityEditing != nil else { return }
                editingActivity = activity
            })
            .sheet(item: $editingActivity) { activity in
                if let service = store.activityEditing {
                    ActivityEditForm(activity: store.activity(id: activity.id) ?? activity, service: service)
                }
            }
    }
}

/// Rows request editing from their screen and keep their own GPX workflow.
struct ActivityRowContextMenu: ViewModifier {
    @Environment(\.locale) private var locale
    @Environment(\.editActivityRow) private var editActivity
    let activity: Activity
    let store: ActivityStore
    var showsMapAction = false
    @State private var workflow = ActivityGPXExportController()

    private var source: ActivityGPXExportSource { .capture(activity: activity, store: store) }

    private var key: ActivityGPXExportKey { .init(activity: activity, store: store) }
    private var availability: ActivityGPXExportAvailability {
        workflow.prepared(for: key) ?? .preflight(activity: activity, summary: store.streamSummaries?.currentSummary(for: String(activity.id)))
    }

    func body(content: Content) -> some View {
        content
            .contextMenu { actions }
            .accessibilityActions { actions }
            .background(ActivityGPXSharePresenter(file: $workflow.file) { error in
                workflow.report(title: String(localized: AppMessages.activityActionShareGPXFailed(locale: locale)), message: error.localizedDescription)
            })
            .alert(item: $workflow.failure) { failure in
                Alert(title: Text(failure.title), message: Text(failure.message), dismissButton: .default(Text(AppMessages.actionOk(locale: locale))))
            }
            .onDisappear { workflow.cancel() }
    }

    private var actions: some View {
        Group {
            Button { editActivity?(activity) } label: { BrowseActionLabel(.edit) }
                .disabled(store.activityEditing == nil || editActivity == nil)
            Button { workflow.export(source: source, current: { source }) } label: {
                Label { Text(workflow.isExporting ? AppMessages.actionPreparingGPX(locale: locale) : AppMessages.actionExportGPXNative(locale: locale)) }
                      icon: { BrowseActionIcon(.exportGPX) }
            }
                .disabled(!availability.canExport || workflow.isExporting || workflow.file != nil)
                .accessibilityHint(Text(availability.hintResource(locale: locale)))
            if showsMapAction {
                Button { store.showOnMap(activity.id) } label: { BrowseActionLabel(.showOnMap) }
                    .disabled(!store.canShowOnMap(activity.id))
            }
        }
        .task(id: key) { await workflow.prepare(source, key: key, current: { self.source }) }
    }
}

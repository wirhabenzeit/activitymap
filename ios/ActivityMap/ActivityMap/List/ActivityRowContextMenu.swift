import SwiftUI

/// Keep presentation state on the row, rather than in the transient menu.
struct ActivityRowContextMenu: ViewModifier {
    let activity: Activity
    let store: ActivityStore
    var showsMapAction = false
    @State private var showsEditor = false
    @State private var exportTask: Task<Void, Never>?
    @State private var file: ActivityGPXFile?
    @State private var failure: Failure?

    private struct Failure: Identifiable {
        let id = UUID()
        let title: String
        let message: String
    }

    func body(content: Content) -> some View {
        content
            .contextMenu { actions }
            .accessibilityActions { actions }
            .sheet(isPresented: $showsEditor) {
                if let service = store.activityEditing {
                    ActivityEditForm(activity: store.activity(id: activity.id) ?? activity, service: service)
                }
            }
            .background(ActivityGPXSharePresenter(file: $file) { error in
                failure = Failure(title: "Couldn’t share GPX", message: error.localizedDescription)
            })
            .alert(item: $failure) { failure in
                Alert(title: Text(failure.title), message: Text(failure.message), dismissButton: .default(Text("OK")))
            }
            .onDisappear {
                exportTask?.cancel()
                file = nil
            }
    }

    private var actions: some View {
        Group {
            Button("Edit", systemImage: "pencil") { showsEditor = true }
                .disabled(store.activityEditing == nil)
            Button(exportTask == nil ? "Share GPX" : "Preparing GPX…", systemImage: "square.and.arrow.up",
                   action: exportGPX)
                .disabled(activity.coordinates.isEmpty || exportTask != nil || file != nil)
            if showsMapAction {
                Button("Show on map", systemImage: "map") { store.showOnMap(activity.id) }
                    .disabled(activity.coordinates.isEmpty)
            }
        }
    }

    private func exportGPX() {
        guard !activity.coordinates.isEmpty, exportTask == nil, file == nil else { return }
        let snapshot = ActivityGPX(activity: activity)
        let cached = store.streamSummaries?.currentSummary(for: String(activity.id))
        exportTask = Task {
            defer { exportTask = nil }
            let worker = Task.detached(priority: .userInitiated) {
                try snapshot.includingSampledElevation(from: cached).write()
            }
            do {
                let result = try await withTaskCancellationHandler { try await worker.value } onCancel: { worker.cancel() }
                try Task.checkCancellation()
                guard cached == store.streamSummaries?.currentSummary(for: String(activity.id)) else { return }
                file = result
            } catch is CancellationError { }
            catch {
                if !Task.isCancelled {
                    failure = Failure(title: "Couldn’t export GPX",
                        message: (error as? ActivityGPX.ExportError)?.localizedDescription
                            ?? "The GPX file couldn’t be created. Please try again.")
                }
            }
        }
    }
}

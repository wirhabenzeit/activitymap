import SwiftUI

struct InitialImportNotice: View {
    let sync: SyncController
    let refresh: () async -> Void
    @State private var dismissedScope: StoreScope?

    var body: some View {
        if let progress = sync.initialImport, dismissedScope != sync.session?.scope {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top) {
                    Text(progress.phase == .empty ? "No activities found in Strava"
                         : progress.isFinished ? "Your recent activities are ready"
                         : progress.message != nil || sync.initialImportError != nil ? "Activity import paused"
                         : "Bringing in your recent activities")
                        .font(.subheadline.weight(.semibold))
                        .accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 8)
                    if progress.isFinished {
                        Button { dismissedScope = sync.session?.scope } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }
                            .accessibilityLabel("Dismiss import message")
                    }
                }
                Text(sync.initialImportError ?? progress.message ?? message(progress))
                    .font(.footnote).foregroundStyle(AppTheme.secondaryText)
                if !progress.isFinished {
                    ProgressView(value: Double(progress.importedCount), total: Double(progress.target))
                        .accessibilityLabel("Recent activities imported")
                        .accessibilityValue("\(progress.importedCount) of up to \(progress.target)")
                    if sync.status != .syncing {
                        TimelineView(.periodic(from: .now, by: 1)) { _ in
                            Button(sync.canRetryInitialImport ? "Retry import" : "Waiting to retry") { Task { await refresh() } }
                                .disabled(!sync.canRetryInitialImport).frame(minHeight: 44)
                        }
                    }
                }
            }
            .padding(12).background(AppTheme.contentBackground)
            .accessibilityIdentifier("initial-import-notice")
        }
    }

    private func message(_ progress: ActivityMapAPI.InitialImport) -> String {
        if progress.phase == .empty { return "New activities will appear here after you record them in Strava." }
        if progress.isFinished {
            return "\(progress.importedCount) activities imported. \(progress.historyComplete ? "Details and photos" : "Older history, details and photos") continue automatically."
        }
        return "\(progress.importedCount) of up to \(progress.target) recent activities imported. You can start exploring as they arrive."
    }
}

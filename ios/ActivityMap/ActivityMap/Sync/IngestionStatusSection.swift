import SwiftUI

struct IngestionStatusSection: View {
    let session: SyncSession
    let controller: IngestionStatusController

    private var snapshot: ActivityMapAPI.IngestionStatus? {
        controller.scope == session.scope ? controller.snapshot : nil
    }
    private var stale: Bool {
        !session.verified || controller.message != nil
            || snapshot.map { IngestionPresentation.stale($0, now: Date()) } == true
    }

    var body: some View {
        Section {
            if let snapshot {
                LabeledContent("All activities imported", value: snapshot.history.progress == .complete ? "Yes"
                    : snapshot.history.progress == .unknown ? "Unknown" : "No")
                IngestionProgressRow(title: "Details", progress: IngestionPresentation.coverageProgress(
                    snapshot.details.detailed, total: snapshot.history.knownActivityCount))
                IngestionProgressRow(title: "Photos", progress: IngestionPresentation.coverageProgress(
                    snapshot.photos.activitiesWithStoredPhotos, total: snapshot.photos.activitiesWithPhotos),
                    emptyLabel: snapshot.photos.activitiesWithPhotos == 0 ? "No photos" : "—")
                IngestionProgressRow(title: "Streams", progress: IngestionPresentation.coverageProgress(
                    snapshot.streams.withData + snapshot.streams.withoutData, total: snapshot.history.knownActivityCount))
                if snapshot.history.scheduling == .blocked || snapshot.details.scheduling == .blocked
                    || snapshot.photos.scheduling == .blocked || snapshot.streams.scheduling == .blocked {
                    Text("Reconnect Strava from Account to continue importing.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            } else {
                Text(controller.isLoading ? "Checking your import…" : "Import status unavailable. Please try again later.")
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("Strava import status")
        } footer: {
            VStack(alignment: .leading, spacing: 3) {
                if snapshot != nil {
                    Text("Fetched for imported activities. Photos count only activities with photos.")
                }
                if stale, let snapshot {
                    Text("\(!session.verified ? "Offline. " : "")Last known status · \(snapshot.observedAt.formatted(date: .abbreviated, time: .shortened))")
                }
                if controller.message == "Sign in again to check server import status." {
                    Text("Sign in again from Account to check status.")
                }
            }
        }
    }
}

private struct IngestionProgressRow: View {
    let title: String
    let progress: IngestionPresentation.CoverageProgress?
    var emptyLabel = "—"

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            LabeledContent(title, value: progress?.percentage ?? emptyLabel)
                .monospacedDigit()
            if let progress {
                ProgressView(value: Double(progress.completed), total: Double(progress.total))
                    .tint(.accentColor)
                    .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(progress?.percentage ?? emptyLabel)
    }
}

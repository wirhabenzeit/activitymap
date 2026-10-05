import SwiftUI

struct IngestionStatusSection: View {
    let session: SyncSession
    @Environment(\.scenePhase) private var scenePhase
    @State private var status: IngestionStatusController

    init(session: SyncSession, controller: IngestionStatusController = IngestionStatusController()) {
        self.session = session
        _status = State(initialValue: controller)
    }
    private var snapshot: ActivityMapAPI.IngestionStatus? { status.scope == session.scope ? status.snapshot : nil }
    private var stale: Bool {
        !session.verified || status.message != nil || snapshot.map { IngestionPresentation.stale($0, now: Date()) } == true
    }

    var body: some View {
        Section {
            if let snapshot {
                let rows = IngestionPresentation.rows(snapshot)
                let summaries = IngestionPresentation.summaries(snapshot)
                ForEach(rows.indices, id: \.self) { index in
                    let summary = summaries[index]
                    NavigationLink {
                        IngestionDetailView(snapshot: snapshot, index: index, stale: stale)
                    } label: {
                        IngestionCoverageView(summary: summary)
                    }
                }
            } else {
                Text(status.isLoading ? "Checking your import…" : "Server status unavailable.")
                    .foregroundStyle(.secondary)
            }
        } header: {
            HStack {
                Text("Strava import")
                Spacer()
                Button { Task { await status.refresh(session) } } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("Check server status")
                    .accessibilityHint(Date() < status.nextCheck ? "Next check after \(status.nextCheck.formatted())" : "Checks status without starting an import")
                    .disabled(status.isLoading || Date() < status.nextCheck || !session.verified)
            }
        } footer: {
            VStack(alignment: .leading, spacing: 3) {
                Text("Strava → ActivityMap")
                if let snapshot {
                    Text("\(stale ? "Last known status" : "Checked") · \(snapshot.observedAt.formatted())")
                }
                if status.message == "Sign in again to check server import status." {
                    Text("Sign in again from Account to check status.")
                } else if status.message != nil {
                    Text(session.verified ? "Couldn’t update status. Try again later." : "Offline. Showing saved status.")
                }
            }
        }
        .task(id: ObservationID(session: session, active: scenePhase == .active)) {
            if scenePhase == .active { await status.observe(session) }
        }
    }
    private struct ObservationID: Equatable { let session: SyncSession; let active: Bool }
}


struct IngestionCoverageView: View {
    let summary: IngestionPresentation.Summary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(summary.title).foregroundStyle(.primary)
                Spacer(minLength: 8)
                if let progress = summary.progress {
                    Text(progress.percentage).monospacedDigit().fontWeight(.semibold)
                        .foregroundStyle(.primary).fixedSize()
                }
            }
            if let progress = summary.progress {
                ProgressView(value: Double(progress.completed), total: Double(progress.total))
                    .tint(.accentColor)
                    .accessibilityHidden(true)
            }
            Text(summary.count).font(.caption).foregroundStyle(.secondary)
            Text(summary.status).font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(summary.title)
        .accessibilityValue([summary.progress?.percentage, summary.count, summary.status].compactMap { $0 }.joined(separator: ", "))
    }
}

struct IngestionDetailView: View {
    let snapshot: ActivityMapAPI.IngestionStatus
    let index: Int
    let stale: Bool

    private var row: IngestionPresentation.Row { IngestionPresentation.rows(snapshot)[index] }
    private var summary: IngestionPresentation.Summary { IngestionPresentation.summaries(snapshot)[index] }

    var body: some View {
        Form {
            Section {
                IngestionCoverageView(summary: summary)
            } footer: {
                if index == 1 || index == 2 {
                    Text("Of the activities imported so far.")
                } else if index == 3 {
                    Text("Counts activities with photos available, not individual images.")
                }
            }
            if index == 0 {
                Section("History check") {
                    if let checked = snapshot.history.reconciliation.lastCompletedAt {
                        LabeledContent("Last full check", value: checked.formatted())
                    } else { Text("A full history check has not finished yet.") }
                    if let due = snapshot.history.reconciliation.nextDueAt {
                        LabeledContent(due <= snapshot.observedAt ? "Refresh was due" : "Next refresh due", value: due.formatted())
                    }
                }
            }
            Section("Background updates") {
                Text((stale ? "At last check: " : "") + row.schedule)
                if let reason = row.reason { Text(reason) }
                if let retry = row.retryAt { LabeledContent("Retry after", value: retry.formatted()) }
            }
            Section {
                DisclosureGroup("More information") {
                    if index == 1 {
                        LabeledContent("Not fetched yet", value: snapshot.details.neverFetched.formatted())
                        LabeledContent("Need refreshing", value: snapshot.details.invalidated.formatted())
                    }
                    if index == 2 {
                        LabeledContent("With recorded data", value: snapshot.streams.withData.formatted())
                        LabeledContent("Checked, no recorded data", value: snapshot.streams.withoutData.formatted())
                        if snapshot.streams.failed > 0 { LabeledContent("Failed", value: snapshot.streams.failed.formatted()) }
                        Text("An activity with no recorded measurements still counts as checked.").foregroundStyle(.secondary)
                    }
                    if index == 3 {
                        LabeledContent("Individual photos stored", value: snapshot.photos.photoCount.formatted())
                        LabeledContent("Collections verified current", value: snapshot.photos.current.formatted())
                        Text("An activity counts when at least one photo is stored. More photos may still need fetching, and available collections may need checking for changes.").foregroundStyle(.secondary)
                    }
                    if let outcome = row.outcome {
                        Text(IngestionPresentation.outcome(outcome))
                        LabeledContent("Last attempt", value: outcome.attemptedAt.formatted())
                    }
                    LabeledContent(stale ? "Last known status" : "Status checked", value: snapshot.observedAt.formatted())
                }
            }
        }
        .navigationTitle(index == 3 ? "Photos" : row.title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

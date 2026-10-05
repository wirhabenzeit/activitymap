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
                    let row = rows[index], summary = summaries[index]
                    NavigationLink {
                        Form {
                            Section(row.coverage) {
                                if index == 3 {
                                    LabeledContent("Activities with photos", value: snapshot.photos.activitiesWithPhotos.formatted())
                                    LabeledContent("Up to date", value: snapshot.photos.current.formatted())
                                    LabeledContent("Need checking", value: (snapshot.photos.refreshRequired + snapshot.photos.unknown).formatted())
                                    LabeledContent("Individual photos stored", value: snapshot.photos.photoCount.formatted())
                                } else {
                                    Text(row.counts)
                                }
                                Text((stale ? "At last check: " : "") + row.schedule)
                                if let reason = row.reason { Text(reason) }
                                if let retry = row.retryAt { Text("Eligible to retry after \(retry.formatted()).") }
                            }
                            if let outcome = row.outcome {
                                Section("Last run") {
                                    Text(IngestionPresentation.outcome(outcome))
                                    Text("Attempted: \(outcome.attemptedAt.formatted())")
                                    if let success = outcome.lastSucceededAt { Text("Last success: \(success.formatted())") }
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
                            if index == 3 {
                                Text("Strava reports which activities have photos before their individual photos are fetched. One activity can have several photos.")
                                    .foregroundStyle(.secondary)
                            }
                            if index == 2 { Text("Activities without GPS or sensors can be fully fetched.").foregroundStyle(.secondary) }
                            Section(stale ? "Last known status" : "Observed") { Text(snapshot.observedAt, format: .dateTime) }
                        }.navigationTitle(row.title)
                    } label: {
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 12) {
                                rowTitle(summary)
                                Spacer(minLength: 8)
                                Text(summary.status).font(.caption).foregroundStyle(.secondary).fixedSize()
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                rowTitle(summary)
                                Text(summary.status).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .accessibilityElement(children: .combine)
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
    private func rowTitle(_ summary: IngestionPresentation.Summary) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(summary.title).foregroundStyle(.primary)
            Text(summary.count).font(.caption).foregroundStyle(.secondary)
        }
    }
    private struct ObservationID: Equatable { let session: SyncSession; let active: Bool }
}

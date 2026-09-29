import SwiftUI

struct BrowsingEmptyView: View {
    let state: BrowsingPresentation.EmptyState
    let recover: (BrowsingPresentation.Recovery) -> Void
    var scrolls = true

    var body: some View {
        VStack(spacing: 0) {
            if scrolls {
                ScrollView { textContent }.scrollBounceBehavior(.basedOnSize)
            } else { textContent }
            if let action = state.recovery {
                Button(action.title) { recover(action) }
                    .buttonStyle(.borderedProminent)
                    .frame(minHeight: 44)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
            }
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("browsing-empty-\(String(describing: state.kind))")
    }

    private var textContent: some View {
        VStack(spacing: 16) {
            if state.progress { ProgressView().accessibilityLabel(state.title) }
            else { Image(systemName: state.symbol).font(.largeTitle).foregroundStyle(.secondary) }
            Text(state.title).font(.title3.weight(.semibold)).multilineTextAlignment(.center)
            Text(state.message).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
    }

}

/// A compact status is reachable on both map and list without replacing the
/// retained browsing surfaces. Full dates/errors are one accessible tap away.
struct BrowsingStatusBar: View {
    let presentation: BrowsingPresentation
    let failureMessage: String?
    let recover: (BrowsingPresentation.Recovery) -> Void
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var showsDetails = false

    var body: some View {
        HStack(spacing: 8) {
            if presentation.isSyncing { ProgressView().accessibilityLabel("Activity sync in progress") }
            Text(presentation.statusTitle)
                .font(.caption)
                .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let action = presentation.recovery {
                Button {
                    recover(action)
                } label: {
                    Image(systemName: action == .cancelSync ? "pause.fill" : action == .account ? "person.crop.circle" : "arrow.clockwise")
                        .frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel(action.title)
            }
            Button {
                showsDetails = true
            } label: {
                Image(systemName: "info.circle").frame(minWidth: 44, minHeight: 44)
            }
            .accessibilityLabel("Sync details, last successful sync and Strava reconciliation")
        }
        .padding(.horizontal)
        .background(.bar)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("browsing-sync-status")
        .sheet(isPresented: $showsDetails) {
            NavigationStack {
                BrowsingSyncDetails(presentation: presentation, failureMessage: failureMessage, recover: recover)
                    .navigationTitle("Sync Details")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Done") { showsDetails = false } }
                    }
            }
            .presentationDetents([.medium, .large])
        }
    }
}

struct BrowsingSyncDetails: View {
    let presentation: BrowsingPresentation
    let failureMessage: String?
    let recover: (BrowsingPresentation.Recovery) -> Void

    var body: some View {
        Form {
            Section("Activity Data") {
                Text(presentation.statusTitle).font(.headline)
                Text(presentation.statusMessage)
                if let failureMessage { Text(failureMessage).font(.footnote).foregroundStyle(.secondary) }
                if let action = presentation.recovery { Button(action.title) { recover(action) } }
            }
            Section {
                timestamp("Last successful sync", date: presentation.lastSync, missing: "No completed sync")
                timestamp("Strava reconciliation", date: presentation.reconciliation, missing: "Not reported by server")
                if let retry = presentation.retryAfter {
                    timestamp("Retry available after", date: retry, missing: "")
                }
            } header: {
                Text("Separate Sync and Reconciliation Times")
            } footer: {
                Text("A successful sync copies server changes. Strava reconciliation says when the server last checked Strava. Older or unreported dates do not expire a valid sign-in or remove saved activities.")
            }
            Section("Photos") {
                Text("\(presentation.photoMetadataCount) known photos")
                Text("Saved photo information does not mean the photo itself is downloaded. Opening a photo may require a connection.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func timestamp(_ label: String, date: Date?, missing: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.subheadline.weight(.semibold))
            if let date {
                Text(date.formatted(date: .abbreviated, time: .shortened))
                    .foregroundStyle(.secondary)
            } else { Text(missing).foregroundStyle(.secondary) }
        }
        .accessibilityElement(children: .combine)
    }
}

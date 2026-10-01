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

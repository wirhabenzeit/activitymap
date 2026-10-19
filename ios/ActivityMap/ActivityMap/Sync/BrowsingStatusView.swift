import SwiftUI

struct BrowsingEmptyView: View {
    @Environment(\.locale) private var locale
    let state: BrowsingPresentation.EmptyState
    let recover: (BrowsingPresentation.Recovery) -> Void
    var scrolls = true

    var body: some View {
        VStack(spacing: 0) {
            if scrolls {
                ScrollView { textContent }.scrollBounceBehavior(.basedOnSize)
            } else { textContent }
            // Connecting is offered once, by the shell's overlay (#304).
            if let action = state.recovery, action != .account {
                Button(action.title(locale: locale)) { recover(action) }
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
            Text(verbatim: state.title).font(.title3.weight(.semibold)).multilineTextAlignment(.center)
            Text(verbatim: state.message).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
    }

}

struct BrowsingSyncDetails: View {
    @Environment(\.locale) private var locale
    let presentation: BrowsingPresentation
    let failureMessage: String?
    let recover: (BrowsingPresentation.Recovery) -> Void

    var body: some View {
        Form {
            Section(String(localized: AppMessages.statusBrowsingActivityData(locale: locale))) {
                Text(verbatim: presentation.statusTitle).font(.headline)
                Text(verbatim: presentation.statusMessage)
                if let failureMessage { Text(verbatim: failureMessage).font(.footnote).foregroundStyle(.secondary) }
                if let action = presentation.recovery { Button(action.title(locale: locale)) { recover(action) } }
            }
            Section {
                timestamp(String(localized: AppMessages.statusBrowsingLastSuccessfulSync(locale: locale)), date: presentation.lastSync, missing: String(localized: AppMessages.statusBrowsingNoCompletedSync(locale: locale)))
                timestamp(String(localized: AppMessages.statusBrowsingStravaReconciliation(locale: locale)), date: presentation.reconciliation, missing: String(localized: AppMessages.statusBrowsingNotReportedByServer(locale: locale)))
                if let retry = presentation.retryAfter {
                    timestamp(String(localized: AppMessages.statusBrowsingRetryAvailableAfter(locale: locale)), date: retry, missing: "")
                }
            } header: {
                Text(String(localized: AppMessages.statusBrowsingSeparateSyncAndReconciliationTimes(locale: locale)))
            } footer: {
                Text(String(localized: AppMessages.statusBrowsingASuccessfulSyncCopiesServerChangesStravaReconciliationSays(locale: locale)))
            }
            Section("Photos") {
                Text(AppMessages.statusBrowsingKnownPhotos(presentation.photoMetadataCount, locale: locale))
                Text(String(localized: AppMessages.statusBrowsingSavedPhotoInformationDoesNotMeanThePhotoItself(locale: locale)))
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

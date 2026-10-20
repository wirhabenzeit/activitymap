import SwiftUI

struct IngestionStatusSection: View {
    @Environment(\.locale) private var locale
    let session: SyncSession
    let controller: IngestionStatusController
    var stravaImport: StravaImportController? = nil

    private var snapshot: ActivityMapAPI.IngestionStatus? {
        controller.scope == session.scope ? controller.snapshot : nil
    }
    private var stale: Bool {
        !session.verified || controller.message != nil
            || snapshot.map { IngestionPresentation.stale($0, now: Date()) } == true
    }

    var body: some View {
        Section {
            if let stravaImport, stravaImport.scope == session.scope {
                Button {
                    Task { await stravaImport.start(session) }
                } label: {
                    HStack {
                        Label { Text(AppMessages.statusBrowsingFetchFromStrava(locale: locale)) } icon: { Image(systemName: "arrow.down.circle") }
                        if stravaImport.isStarting || stravaImport.snapshot?.status == .running {
                            Spacer()
                            ProgressView().accessibilityLabel(Text(AppMessages.statusBrowsingFetchingFromStrava(locale: locale)))
                        }
                    }
                }.disabled(!stravaImport.canStart(session))
                Text(AppMessages.statusBrowsingFetchRecentActivitiesMissingDetailsAndPhotosAndMore(locale: locale))
                    .font(.footnote).foregroundStyle(.secondary)
                if let message = stravaImport.message(locale: locale) ?? stravaImport.progressMessage(locale: locale) {
                    Text(verbatim: message).font(.footnote).foregroundStyle(.secondary)
                        .accessibilityAddTraits(.updatesFrequently)
                }
                if stravaImport.retryAt > Date() {
                    Text(AppMessages.mutationRetryAfter(stravaImport.retryAt.formatted(date: .abbreviated, time: .shortened), locale: locale))
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            if let snapshot {
                LabeledContent(String(localized: AppMessages.statusBrowsingAllActivitiesImported(locale: locale)), value: snapshot.history.progress == .complete ? String(localized: AppMessages.valueYes(locale: locale))
                    : snapshot.history.progress == .unknown ? String(localized: AppMessages.statusProgressUnknown(locale: locale)) : String(localized: AppMessages.valueNo(locale: locale)))
                IngestionProgressRow(title: AppMessages.statusSummaryDetails(locale: locale), progress: IngestionPresentation.coverageProgress(
                    snapshot.details.detailed, total: snapshot.history.knownActivityCount))
                IngestionProgressRow(title: AppMessages.statusSummaryPhotos(locale: locale), progress: IngestionPresentation.coverageProgress(
                    snapshot.photos.activitiesWithStoredPhotos, total: snapshot.photos.activitiesWithPhotos),
                    emptyLabel: snapshot.photos.activitiesWithPhotos == 0 ? String(localized: AppMessages.statusBrowsingNoPhotos(locale: locale)) : "—")
                IngestionProgressRow(title: AppMessages.statusSummaryStreams(locale: locale), progress: IngestionPresentation.coverageProgress(
                    snapshot.streams.withData + snapshot.streams.withoutData, total: snapshot.history.knownActivityCount))
                if snapshot.history.scheduling == .blocked || snapshot.details.scheduling == .blocked
                    || snapshot.photos.scheduling == .blocked || snapshot.streams.scheduling == .blocked {
                    Text(AppMessages.statusBrowsingReconnectStravaFromAccountToContinueImporting(locale: locale))
                        .font(.footnote).foregroundStyle(.secondary)
                }
            } else {
                Text(controller.isLoading ? AppMessages.statusBrowsingCheckingYourImport(locale: locale) : AppMessages.statusBrowsingImportStatusUnavailablePleaseTryAgainLater(locale: locale))
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text(AppMessages.statusBrowsingStravaImportStatus(locale: locale))
        } footer: {
            VStack(alignment: .leading, spacing: 3) {
                if snapshot != nil {
                    Text(AppMessages.statusBrowsingFetchedForImportedActivitiesPhotosCountOnlyActivitiesWith(locale: locale))
                }
                if stale, let snapshot {
                    Text(session.verified ? AppMessages.statusBrowsingLastKnown(snapshot.observedAt.formatted(date: .abbreviated, time: .shortened), locale: locale) : AppMessages.statusBrowsingOfflineLastKnown(snapshot.observedAt.formatted(date: .abbreviated, time: .shortened), locale: locale))
                }
                if controller.requiresSignIn {
                    Text(AppMessages.statusBrowsingSignInAgainFromAccountToCheckStatus(locale: locale))
                }
            }
        }
    }
}

private struct IngestionProgressRow: View {
    @Environment(\.locale) private var locale
    let title: LocalizedStringResource
    let progress: IngestionPresentation.CoverageProgress?
    var emptyLabel = "—"

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            LabeledContent { Text(verbatim: progress?.formattedPercentage(locale: locale) ?? emptyLabel) } label: { Text(title) }
                .monospacedDigit()
            if let progress {
                ProgressView(value: Double(progress.completed), total: Double(progress.total))
                    .tint(.accentColor)
                    .accessibilityHidden(true)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(title))
        .accessibilityValue(progress?.formattedPercentage(locale: locale) ?? emptyLabel)
    }
}

import SwiftUI

struct ActivityShareButton<Label: View>: View {
    var activities: () -> [Activity]
    @ViewBuilder var label: () -> Label
    @State private var draft: Draft?
    private struct Draft: Identifiable {
        let id = UUID()
        let activities: [Activity]
    }

    var body: some View {
        Button { draft = Draft(activities: activities()) } label: { label() }
            .sheet(item: $draft) { draft in ActivityShareView(activities: draft.activities) }
    }
}

struct SelectionShareButton: View {
    @Environment(\.locale) private var locale
    let store: ActivityStore
    var onNavigationBar = false
    var body: some View {
        if !store.selectedActivityIDs.isEmpty {
            ActivityShareButton(activities: { store.activities.filter { store.selectedActivityIDs.contains($0.id) } }) {
                Image(systemName: "square.and.arrow.up")
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .foregroundStyle(onNavigationBar ? Color.white : AppTheme.accent)
            .accessibilityLabel(String(localized: AppMessages.sharingShareSelectedActivities(locale: locale)))
            .accessibilityHint(Text(AppMessages.sharingSelectionHint(store.selectedActivityIDs.count, locale: locale)))
            .accessibilityIdentifier("share-selection")
        }
    }
}

/// Map hit results are browse context; group sharing belongs to Combine mode.
/// An open detail always narrows sharing to that activity, regardless of mode.
struct MapActivityShareButton: View {
    @Environment(\.locale) private var locale
    let picker: RoutePicker
    let store: ActivityStore

    var body: some View {
        if !picker.activitiesToShare(in: store).isEmpty {
            ActivityShareButton(activities: { picker.activitiesToShare(in: store) }) {
                Image(systemName: "square.and.arrow.up")
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .foregroundStyle(AppTheme.accent)
            .accessibilityLabel(picker.detailID == nil ? String(localized: AppMessages.sharingShareSelectedActivities(locale: locale)) : String(localized: AppMessages.actionShareActivity(locale: locale)))
            .accessibilityHint(picker.detailID == nil ? String(localized: AppMessages.sharingShareTheSelectedGroupIncludingActivitiesHiddenBy(locale: locale)) : String(localized: AppMessages.sharingShareOnlyTheActivityWhoseDetailsAreOpen(locale: locale)))
            .accessibilityIdentifier("map-share")
        }
    }
}

extension RoutePicker {
    func activitiesToShare(in store: ActivityStore) -> [Activity] {
        if let detailID {
            guard candidateIDs.contains(detailID), store.visibleActivityIDs.contains(detailID),
                  let activity = store.activity(id: detailID) else { return [] }
            return [activity]
        }
        guard store.isCombining else { return [] }
        return store.activities.filter { store.selectedActivityIDs.contains($0.id) }
    }
}

struct ActivityShareView: View {
    @Environment(DisplayPreferences.self) private var preferences: DisplayPreferences?
    @Environment(\.locale) private var locale
    @State private var model: ActivityShareModel
    @State private var currentTime = Date()
    @Environment(\.activitySharing) private var service
    @Environment(\.dismiss) private var dismiss
    private let expiryOptions = [1, 24, 72, 168, 336, 720]

    init(activities: [Activity]) { _model = State(initialValue: ActivityShareModel(activities: activities)) }
    init(model: ActivityShareModel) { _model = State(initialValue: model) }

    var body: some View {
        NavigationStack {
            Form {
                if model.step == .created, let url = model.url, let link = model.created {
                    Section {
                        ShareLink(item: url) { Label(String(localized: AppMessages.sharingShareLink(locale: locale)), systemImage: "square.and.arrow.up") }
                            .foregroundStyle(AppTheme.accent)
                            .accessibilityIdentifier("share-created-link")
                        Text(verbatim: url.absoluteString).font(.caption).textSelection(.enabled)
                        LabeledContent(String(localized: AppMessages.sharingExpires(locale: locale)), value: link.expiresAt.formatted(date: .abbreviated, time: .shortened))
                    } header: { Text(String(localized: AppMessages.sharingLinkCreated(locale: locale))) }
                    footer: { Text(String(localized: AppMessages.sharingShareOrCopyItNowTheFullLink(locale: locale))) }
                } else {
                    Section {
                        ForEach(model.activities) { activity in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(verbatim: activity.name)
                                Text(Formatters.shortDateTime(activity.startDateLocal, timeZone: .gmt, locale: locale, dateFormat: preferences?.dateFormat ?? .system)).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    } header: { Text(AppMessages.selectionCount(model.activities.count, locale: locale)) }
                    footer: { Text(String(localized: AppMessages.sharingOnlyTheseActivitiesAreIncludedAnyoneWithThe(locale: locale))) }

                    Section {
                        Picker(String(localized: AppMessages.sharingExpiresAfter(locale: locale)), selection: $model.expiresInHours) {
                            ForEach(expiryOptions, id: \.self) { hours in Text(expiryLabel(hours)).tag(hours) }
                        }
                        Toggle(String(localized: AppMessages.sharingShowStartAndFinish(locale: locale)), isOn: $model.showRouteEnds)
                    } footer: { Text(String(localized: AppMessages.sharingTheFirstAndLastMOfEachRoute(locale: locale))) }
                    .disabled(model.isBusy)
                    Section(String(localized: AppMessages.sharingShownToRecipients(locale: locale))) {
                        Text(String(localized: AppMessages.sharingRouteElevationProfileNameSportDateAndTime(locale: locale)))
                        Text(String(localized: AppMessages.sharingHeartRatePowerCaloriesSocialInformationDescriptionsAnd(locale: locale)))
                            .foregroundStyle(.secondary)
                    }
                    if let message = model.scopeError ?? service?.unavailableReason ?? (service == nil ? String(localized: AppMessages.errorSharingSignInToShareActivities(locale: locale)) : nil) {
                        Section { Text(message).foregroundStyle(.secondary) }
                    }
                    if let error = model.errorMessage(locale: locale) {
                        Section {
                            Text(verbatim: error).foregroundStyle(.red)
                            if let retry = model.retryAt { Text(AppMessages.mutationRetryAfter(retry.formatted(date: .omitted, time: .standard), locale: locale)) }
                        }.accessibilityIdentifier("share-error")
                    }
                    Section {
                        Button {
                            guard let service else { return }
                            Task { await model.create(using: service) }
                        } label: {
                            HStack {
                                Text(model.isBusy ? String(localized: AppMessages.sharingCreating(locale: locale)) : String(localized: AppMessages.sharingCreateLink(locale: locale)))
                                if model.isBusy { Spacer(); ProgressView() }
                            }
                        }
                        .disabled(cannotCreate || model.isBusy || model.retryAt.map { $0 > currentTime } == true)
                        .foregroundStyle(AppTheme.accent)
                        .accessibilityIdentifier("share-create-link")
                    }
                }
                Section {
                    NavigationLink(String(localized: AppMessages.sharingYourLinks(locale: locale))) { ShareLinksListView() }
                        .disabled(model.isBusy || service?.unavailableReason != nil || service == nil)
                }
            }
            .navigationTitle(String(localized: AppMessages.sharingShareActivities(locale: locale)))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) {
                Button(String(localized: AppMessages.actionDone(locale: locale))) { dismiss() }.disabled(model.isBusy)
            } }
        }
        .foregroundStyle(Color.primary).tint(AppTheme.accent)
        .interactiveDismissDisabled(model.isBusy)
        .onChange(of: service?.session()) { old, new in
            if old?.scope != new?.scope || old?.token != new?.token || service?.unavailableReason != nil { dismiss() }
        }
        .task(id: model.retryAt) {
            guard let retry = model.retryAt else { return }
            do { try await Task.sleep(for: .seconds(max(0, retry.timeIntervalSinceNow))) }
            catch { return }
            currentTime = .now
        }
    }

    private var cannotCreate: Bool { model.scopeError != nil || service == nil || service?.unavailableReason != nil }
    private func expiryLabel(_ hours: Int) -> String { String(localized: hours == 1 ? AppMessages.sharingExpiryHours(hours, locale: locale) : AppMessages.sharingExpiryDays(hours / 24, locale: locale)) }
}

struct ShareLinksListView: View {
    @Environment(\.locale) private var locale
    @Environment(\.activitySharing) private var service
    @State private var links: [ActivityMapAPI.ShareLinkSummary]?
    @State private var errorMessage: PresentationText?
    @State private var busy = false
    @State private var pendingRevocation: ActivityMapAPI.ShareLinkSummary?

    var body: some View {
        List {
            if let errorMessage {
                Text(verbatim: errorMessage.string(locale: locale)).foregroundStyle(.red)
                Button(String(localized: AppMessages.actionRetry(locale: locale))) { Task { await load() } }.disabled(busy)
            }
            if let links {
                if links.isEmpty { Text(String(localized: AppMessages.sharingYouHaveNoShareLinks(locale: locale))).foregroundStyle(.secondary) }
                ForEach(links, id: \.id) { link in
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(link.activityCount) activities").font(.headline)
                        Text("Created \(link.createdAt.formatted(date: .abbreviated, time: .shortened))").font(.caption)
                        Text("\(link.status.rawValue.capitalized) · expires \(link.expiresAt.formatted(date: .abbreviated, time: .shortened))")
                            .font(.caption).foregroundStyle(.secondary)
                        if link.status == .active && link.expiresAt > .now {
                            Button(String(localized: AppMessages.sharingRevokeLink(locale: locale)), role: .destructive) { pendingRevocation = link }.disabled(busy)
                        }
                    }.padding(.vertical, 4)
                }
            } else if busy { ProgressView(String(localized: AppMessages.sharingLoadingLinks(locale: locale))) }
        }
        .navigationTitle(String(localized: AppMessages.sharingYourLinks(locale: locale)))
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog(String(localized: AppMessages.sharingRevokeThisLink(locale: locale)), isPresented: Binding(
            get: { pendingRevocation != nil }, set: { if !$0 { pendingRevocation = nil } }), titleVisibility: .visible) {
                if let link = pendingRevocation {
                    Button(String(localized: AppMessages.sharingRevokeLink(locale: locale)), role: .destructive) { Task { await revoke(link) } }
                }
        } message: { Text(String(localized: AppMessages.sharingAnyoneWithThisLinkWillLoseAccessImmediately(locale: locale))) }
    }

    private func load() async {
        guard !busy, let service else { return }
        busy = true; errorMessage = nil
        defer { busy = false }
        do { links = try await service.perform { source, _ in try await source.list() } }
        catch is CancellationError { }
        catch { errorMessage = .localized(AppMessages.sharingCouldnTLoadYourLinksCheckYourConnection(locale: locale)) }
    }

    private func revoke(_ link: ActivityMapAPI.ShareLinkSummary) async {
        guard !busy, let service else { return }
        busy = true; errorMessage = nil
        do {
            try await service.perform { source, _ in try await source.revoke(id: link.id) }
            links = nil
            busy = false
            await load()
        } catch {
            busy = false
            errorMessage = .localized(AppMessages.sharingRevocationCouldNotBeConfirmedRefreshYourLinks(locale: locale))
        }
    }
}

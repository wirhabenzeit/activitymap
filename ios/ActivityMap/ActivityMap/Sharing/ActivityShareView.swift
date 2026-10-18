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
    let store: ActivityStore
    var onNavigationBar = false
    var body: some View {
        if !store.selectedActivityIDs.isEmpty {
            ActivityShareButton(activities: { store.activities.filter { store.selectedActivityIDs.contains($0.id) } }) {
                Image(systemName: "square.and.arrow.up")
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .foregroundStyle(onNavigationBar ? Color.white : AppTheme.accent)
            .accessibilityLabel("Share selected activities")
            .accessibilityHint("Review all \(store.selectedActivityIDs.count) selected activities, including those hidden by filters")
            .accessibilityIdentifier("share-selection")
        }
    }
}

/// Map hit results are browse context; group sharing belongs to Combine mode.
/// An open detail always narrows sharing to that activity, regardless of mode.
struct MapActivityShareButton: View {
    let picker: RoutePicker
    let store: ActivityStore

    var body: some View {
        if !picker.activitiesToShare(in: store).isEmpty {
            ActivityShareButton(activities: { picker.activitiesToShare(in: store) }) {
                Image(systemName: "square.and.arrow.up")
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .foregroundStyle(AppTheme.accent)
            .accessibilityLabel(picker.detailID == nil ? "Share selected activities" : "Share activity")
            .accessibilityHint(picker.detailID == nil ? "Share the selected group, including activities hidden by filters" : "Share only the activity whose details are open")
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
                        ShareLink(item: url) { Label("Share link", systemImage: "square.and.arrow.up") }
                            .foregroundStyle(AppTheme.accent)
                            .accessibilityIdentifier("share-created-link")
                        Text(url.absoluteString).font(.caption).textSelection(.enabled)
                        LabeledContent("Expires", value: link.expiresAt.formatted(date: .abbreviated, time: .shortened))
                    } header: { Text("Link created") }
                    footer: { Text("Share or copy it now. The full link is only available until you close this sheet.") }
                } else {
                    Section {
                        ForEach(model.activities) { activity in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(activity.name)
                                Text(Formatters.shortDateTime(activity.startDateLocal, timeZone: .gmt)).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    } header: { Text(model.activities.count == 1 ? "1 activity" : "\(model.activities.count) activities") }
                    footer: { Text("Only these activities are included. Anyone with the link can view them until it expires or you revoke it. Activities marked private in Strava are omitted from the shared map.") }

                    Section {
                        Picker("Expires after", selection: $model.expiresInHours) {
                            ForEach(expiryOptions, id: \.self) { hours in Text(expiryLabel(hours)).tag(hours) }
                        }
                        Toggle("Show start and finish", isOn: $model.showRouteEnds)
                    } footer: { Text("The first and last 200 m of each route and elevation profile are hidden unless you choose to show them.") }
                    .disabled(model.isBusy)
                    Section("Shown to recipients") {
                        Text("Route, elevation profile, name, sport, date and time, distance, moving time, elevation gain and average speed.")
                        Text("Heart rate, power, calories, social information, descriptions and photos are excluded.")
                            .foregroundStyle(.secondary)
                    }
                    if let message = model.scopeError ?? service?.unavailableReason ?? (service == nil ? "Sign in to share activities." : nil) {
                        Section { Text(message).foregroundStyle(.secondary) }
                    }
                    if let error = model.errorMessage {
                        Section {
                            Text(error).foregroundStyle(.red)
                            if let retry = model.retryAt { Text("Try again after \(retry.formatted(date: .omitted, time: .standard)).") }
                        }.accessibilityIdentifier("share-error")
                    }
                    Section {
                        Button {
                            guard let service else { return }
                            Task { await model.create(using: service) }
                        } label: {
                            HStack {
                                Text(model.isBusy ? "Creating…" : "Create link")
                                if model.isBusy { Spacer(); ProgressView() }
                            }
                        }
                        .disabled(cannotCreate || model.isBusy || model.retryAt.map { $0 > currentTime } == true)
                        .foregroundStyle(AppTheme.accent)
                        .accessibilityIdentifier("share-create-link")
                    }
                }
                Section {
                    NavigationLink("Your links") { ShareLinksListView() }
                        .disabled(model.isBusy || service?.unavailableReason != nil || service == nil)
                }
            }
            .navigationTitle("Share activities")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }.disabled(model.isBusy)
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
    private func expiryLabel(_ hours: Int) -> String { hours == 1 ? "1 hour" : hours == 24 ? "1 day" : "\(hours / 24) days" }
}

struct ShareLinksListView: View {
    @Environment(\.activitySharing) private var service
    @State private var links: [ActivityMapAPI.ShareLinkSummary]?
    @State private var errorMessage: String?
    @State private var busy = false
    @State private var pendingRevocation: ActivityMapAPI.ShareLinkSummary?

    var body: some View {
        List {
            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
                Button("Retry") { Task { await load() } }.disabled(busy)
            }
            if let links {
                if links.isEmpty { Text("You have no share links.").foregroundStyle(.secondary) }
                ForEach(links, id: \.id) { link in
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(link.activityCount) activities").font(.headline)
                        Text("Created \(link.createdAt.formatted(date: .abbreviated, time: .shortened))").font(.caption)
                        Text("\(link.status.rawValue.capitalized) · expires \(link.expiresAt.formatted(date: .abbreviated, time: .shortened))")
                            .font(.caption).foregroundStyle(.secondary)
                        if link.status == .active && link.expiresAt > .now {
                            Button("Revoke link", role: .destructive) { pendingRevocation = link }.disabled(busy)
                        }
                    }.padding(.vertical, 4)
                }
            } else if busy { ProgressView("Loading links…") }
        }
        .navigationTitle("Your links")
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog("Revoke this link?", isPresented: Binding(
            get: { pendingRevocation != nil }, set: { if !$0 { pendingRevocation = nil } }), titleVisibility: .visible) {
                if let link = pendingRevocation {
                    Button("Revoke link", role: .destructive) { Task { await revoke(link) } }
                }
        } message: { Text("Anyone with this link will lose access immediately.") }
    }

    private func load() async {
        guard !busy, let service else { return }
        busy = true; errorMessage = nil
        defer { busy = false }
        do { links = try await service.perform { source, _ in try await source.list() } }
        catch is CancellationError { }
        catch { errorMessage = "Couldn’t load your links. Check your connection and try again." }
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
            errorMessage = "Revocation could not be confirmed. Refresh your links and try again."
        }
    }
}

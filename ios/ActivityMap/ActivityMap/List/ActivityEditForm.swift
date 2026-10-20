import SwiftUI
import UIKit

struct ActivityEditForm: View {
    @Environment(\.locale) private var locale
    @State private var model: ActivityEditModel
    let service: ActivityEditingService
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    @State private var showsDiscardConfirmation = false
    @State private var currentTime = Date()
    @FocusState private var focusedField: Field?
    private enum Field: Hashable { case name, description }

    init(activity: Activity, service: ActivityEditingService) {
        _model = State(initialValue: ActivityEditModel(activity: activity))
        self.service = service
    }

    /// Injectable model lets rendered tests exercise the actual form states.
    init(model: ActivityEditModel, service: ActivityEditingService) {
        _model = State(initialValue: model)
        self.service = service
    }

    var body: some View {
        ZStack {
            editor
                .allowsHitTesting(!model.isSaving)
                .accessibilityHidden(model.isSaving)
            if model.isSaving { savingOverlay }
        }
        // The activity toolbar may use white foreground/tint over the blue
        // navigation bar. This sheet owns its readable semantic appearance.
        .foregroundStyle(Color.primary)
        .tint(AppTheme.accent)
        .task(id: model.retryAt) {
            guard let deadline = model.retryAt else { return }
            do { try await Task.sleep(for: .seconds(max(0, deadline.timeIntervalSinceNow))) }
            catch { return }
            currentTime = Date()
        }
    }

    private var editor: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(AppMessages.activityEditName(locale: locale)).font(.caption).foregroundStyle(.secondary)
                        TextField(text: $model.name, axis: .vertical) { Text(AppMessages.activityEditNamePlaceholder(locale: locale)) }
                            .focused($focusedField, equals: .name)
                            .font(.body).foregroundStyle(Color.primary)
                            .accessibilityLabel(Text(AppMessages.activityEditName(locale: locale)))
                            .accessibilityIdentifier("activity-edit-name")
                    }
                    .padding(.vertical, 4)
                    NavigationLink {
                        ActivityEditSportPicker(sport: $model.sport)
                    } label: {
                        HStack(spacing: 12) {
                            BrowseSportSymbol(category: model.sport.category)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(AppMessages.activityEditSport(locale: locale)).font(.caption).foregroundStyle(.secondary)
                                Text(verbatim: model.sport.editingTitle).font(.body).foregroundStyle(Color.primary)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 4)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(Text(AppMessages.activityEditSport(locale: locale)))
                    .accessibilityValue(model.sport.editingTitle)
                    .accessibilityHint(Text(AppMessages.activityEditChooseSport(locale: locale)))
                    .accessibilityIdentifier("activity-edit-sport")
                } header: { Text(AppMessages.activityGroupActivity(locale: locale)) }
                Section {
                    TextField(text: $model.description, axis: .vertical) { Text(AppMessages.activityEditDescription(locale: locale)) }
                        .focused($focusedField, equals: .description)
                        .lineLimit(3...8)
                        .foregroundStyle(Color.primary)
                        .accessibilityLabel(Text(AppMessages.activityEditDescription(locale: locale)))
                        .accessibilityIdentifier("activity-edit-description")
                } header: { Text(AppMessages.activityEditDescription(locale: locale)) }
                Section {
                    if let message = model.validationMessage(locale: locale) {
                        Text(verbatim: message).foregroundStyle(.red).accessibilityIdentifier("activity-edit-validation")
                    }
                    if let reason = service.unavailableReason(locale: locale) { Text(reason).foregroundStyle(.secondary) }
                    if let message = model.errorMessage(locale: locale) {
                        Text(verbatim: message).foregroundStyle(.red).accessibilityIdentifier("activity-edit-error")
                    }
                    if let retryAt = model.retryAt, retryAt > Date() {
                        Text(AppMessages.mutationRetryAfter(retryAt.formatted(date: .omitted, time: .standard), locale: locale))
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                } footer: {
                    Label { Text(AppMessages.activityEditFooter(locale: locale)) } icon: { Image(systemName: "arrow.up.circle") }
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .foregroundStyle(Color.primary)
            .navigationTitle(Text(AppMessages.activityEditTitle(locale: locale)))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(AppTheme.contentBackground, for: .navigationBar)
            .toolbarBackgroundVisibility(.visible, for: .navigationBar)
            .toolbarColorScheme(colorScheme, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel, action: cancel) {
                        Text(AppMessages.activityEditCancel(locale: locale)).font(.body)
                            .lineLimit(1).fixedSize(horizontal: true, vertical: false)
                            .frame(minHeight: 44)
                    }
                        .buttonStyle(.plain)
                        .foregroundStyle(AppTheme.accent)
                        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                        .disabled(model.isSaving)
                        .accessibilityIdentifier("activity-edit-cancel")
                }.sharedBackgroundVisibility(.hidden)
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        focusedField = nil
                        // A committed edit may hide its own detail through filters.
                        // Let the submitted write finish; the coordinator fences
                        // account/deletion changes independently of this presenter.
                        Task {
                            await model.save(using: service)
                            if model.didSave {
                                UIAccessibility.post(notification: .announcement, argument: String(localized: AppMessages.activityEditSavedAnnouncement(locale: locale)))
                                dismiss()
                            }
                        }
                    } label: {
                        Text(AppMessages.activityEditSaveNative(locale: locale))
                            .accessibilityLabel(Text(AppMessages.activityEditSave(locale: locale)))
                            .font(.body.weight(.semibold))
                            .lineLimit(1).fixedSize(horizontal: true, vertical: false)
                            .foregroundStyle(canSave ? Color.white : Color.primary)
                            .padding(.horizontal, 18)
                            .frame(minHeight: 36)
                            .background(canSave ? AppTheme.navigationBlue : Color(uiColor: .tertiarySystemFill), in: Capsule())
                            .frame(minHeight: 44)
                    }
                    .buttonStyle(.plain)
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                    .disabled(!canSave)
                    .accessibilityIdentifier("activity-edit-save")
                }.sharedBackgroundVisibility(.hidden)
            }
            .confirmationDialog(Text(AppMessages.activityEditDiscardQuestion(locale: locale)), isPresented: $showsDiscardConfirmation, titleVisibility: .visible) {
                Button(role: .destructive) { dismiss() } label: { Text(AppMessages.activityEditDiscard(locale: locale)) }
                Button(role: .cancel) {} label: { Text(AppMessages.activityEditKeepEditing(locale: locale)) }
            }
            .interactiveDismissDisabled(model.isDirty || model.isSaving)
            .accessibilityAction(.escape) { cancel() }
        }
    }

    private var savingOverlay: some View {
        ZStack {
            Color.black.opacity(0.18).ignoresSafeArea()
            VStack(spacing: 16) {
                ProgressView().controlSize(.large).tint(AppTheme.accent)
                Text(AppMessages.activityEditSaving(locale: locale))
                    .font(.headline).foregroundStyle(Color.primary)
                    .multilineTextAlignment(.center)
            }
            .padding(28)
            .frame(maxWidth: 300)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
            .shadow(color: .black.opacity(0.12), radius: 16, y: 6)
            .padding(24)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(AppMessages.activityEditSavingAnnouncement(locale: locale)))
            .accessibilityAddTraits(.isModal)
            .accessibilityIdentifier("activity-edit-saving-overlay")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .ignoresSafeArea()
        .onAppear { UIAccessibility.post(notification: .announcement, argument: String(localized: AppMessages.activityEditSavingAnnouncement(locale: locale))) }
    }

    private var canSave: Bool { model.canSave(now: currentTime) && service.unavailableReason == nil }

    private func cancel() {
        guard !model.isSaving else { return }
        if model.isDirty { showsDiscardConfirmation = true }
        else { dismiss() }
    }
}

struct ActivityEditSportPicker: View {
    @Environment(\.locale) private var locale
    @Binding var sport: SportType
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    var body: some View {
        List {
            ForEach(ActivityCategory.allCases) { category in
                let sports = category.sportTypes.filter {
                    search.isEmpty || $0.editingTitle.localizedCaseInsensitiveContains(search)
                }
                if !sports.isEmpty {
                    Section(category.name) {
                        ForEach(sports) { choice in
                            Button {
                                sport = choice
                                dismiss()
                            } label: {
                                HStack {
                                    Text(verbatim: choice.editingTitle).foregroundStyle(Color.primary)
                                    Spacer()
                                    if choice == sport {
                                        Image(systemName: "checkmark").foregroundStyle(AppTheme.accent)
                                    }
                                }
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(choice.editingTitle)
                            .accessibilityAddTraits(choice == sport ? .isSelected : [])
                        }
                    }
                }
            }
        }
        .searchable(text: $search, prompt: Text(AppMessages.activityEditFindSport(locale: locale)))
        .navigationTitle(Text(AppMessages.activityEditSport(locale: locale)))
        .navigationBarTitleDisplayMode(.inline)
        .foregroundStyle(Color.primary)
        .tint(AppTheme.accent)
    }
}

extension SportType {
    var editingTitle: String {
        switch self {
        case .eBikeRide: "E-bike ride"
        case .eMountainBikeRide: "E-mountain bike ride"
        default: rawValue.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression)
        }
    }
}

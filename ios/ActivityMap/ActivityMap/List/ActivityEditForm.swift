import SwiftUI
import UIKit

struct ActivityEditForm: View {
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
                        Text("Name").font(.caption).foregroundStyle(.secondary)
                        TextField("Activity name", text: $model.name, axis: .vertical)
                            .focused($focusedField, equals: .name)
                            .font(.body).foregroundStyle(Color.primary)
                            .accessibilityLabel("Name")
                            .accessibilityIdentifier("activity-edit-name")
                    }
                    .padding(.vertical, 4)
                    NavigationLink {
                        ActivityEditSportPicker(sport: $model.sport)
                    } label: {
                        HStack(spacing: 12) {
                            BrowseSportSymbol(category: model.sport.category)
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Sport").font(.caption).foregroundStyle(.secondary)
                                Text(model.sport.editingTitle).font(.body).foregroundStyle(Color.primary)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 4)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Sport")
                    .accessibilityValue(model.sport.editingTitle)
                    .accessibilityHint("Choose a sport")
                    .accessibilityIdentifier("activity-edit-sport")
                } header: { Text("Activity") }
                Section("Description") {
                    TextField("Description", text: $model.description, axis: .vertical)
                        .focused($focusedField, equals: .description)
                        .lineLimit(3...8)
                        .foregroundStyle(Color.primary)
                        .accessibilityLabel("Description")
                        .accessibilityIdentifier("activity-edit-description")
                }
                Section {
                    if let message = model.validationMessage {
                        Text(message).foregroundStyle(.red).accessibilityIdentifier("activity-edit-validation")
                    }
                    if let reason = service.unavailableReason { Text(reason).foregroundStyle(.secondary) }
                    if let message = model.errorMessage {
                        Text(message).foregroundStyle(.red).accessibilityIdentifier("activity-edit-error")
                    }
                    if let retryAt = model.retryAt, retryAt > Date() {
                        Text("Try again after \(retryAt.formatted(date: .omitted, time: .standard)).")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                } footer: {
                    Label("Changes are saved to Strava", systemImage: "arrow.up.circle")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .foregroundStyle(Color.primary)
            .navigationTitle("Edit activity")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(AppTheme.contentBackground, for: .navigationBar)
            .toolbarBackgroundVisibility(.visible, for: .navigationBar)
            .toolbarColorScheme(colorScheme, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel, action: cancel) {
                        Text("Cancel").font(.body)
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
                                UIAccessibility.post(notification: .announcement, argument: "Activity saved to Strava")
                                dismiss()
                            }
                        }
                    } label: {
                        Text("Save")
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
            .confirmationDialog("Discard your changes?", isPresented: $showsDiscardConfirmation, titleVisibility: .visible) {
                Button("Discard changes", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
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
                Text("Saving to Strava…")
                    .font(.headline).foregroundStyle(Color.primary)
                    .multilineTextAlignment(.center)
            }
            .padding(28)
            .frame(maxWidth: 300)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
            .shadow(color: .black.opacity(0.12), radius: 16, y: 6)
            .padding(24)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Saving to Strava")
            .accessibilityAddTraits(.isModal)
            .accessibilityIdentifier("activity-edit-saving-overlay")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .ignoresSafeArea()
        .onAppear { UIAccessibility.post(notification: .announcement, argument: "Saving to Strava") }
    }

    private var canSave: Bool { model.canSave(now: currentTime) && service.unavailableReason == nil }

    private func cancel() {
        guard !model.isSaving else { return }
        if model.isDirty { showsDiscardConfirmation = true }
        else { dismiss() }
    }
}

struct ActivityEditSportPicker: View {
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
                                    Text(choice.editingTitle).foregroundStyle(Color.primary)
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
        .searchable(text: $search, prompt: "Find a sport")
        .navigationTitle("Sport")
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

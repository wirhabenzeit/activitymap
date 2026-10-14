import SwiftUI
import UIKit

/// Each detail host presents its own editor, including above a native Map sheet.
struct ActivityEditButton: View {
    let activity: Activity
    let service: ActivityEditingService
    var onNavigationBar = false
    var labelled = false
    @State private var isPresented = false

    var body: some View {
        Group {
            if labelled {
                Button { isPresented = true } label: {
                    Label("Edit", systemImage: "pencil").font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 12).frame(minHeight: 44)
                }
                .accessibilityLabel("Edit activity")
                .accessibilityIdentifier("activity-actions")
            } else {
                Menu {
                    Button { isPresented = true } label: { Label("Edit activity", systemImage: "pencil") }
                        .accessibilityIdentifier("activity-edit-action")
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.body.weight(.semibold))
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel("More activity actions")
                .accessibilityIdentifier("activity-actions")
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(onNavigationBar ? Color.white : AppTheme.accent)
        .sheet(isPresented: $isPresented) {
            ActivityEditForm(activity: activity, service: service)
        }
    }
}

struct ActivityEditForm: View {
    @State private var model: ActivityEditModel
    let service: ActivityEditingService
    @Environment(\.dismiss) private var dismiss
    @State private var showsDiscardConfirmation = false
    @State private var currentTime = Date()

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
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $model.name, axis: .vertical)
                        .accessibilityLabel("Name")
                        .accessibilityIdentifier("activity-edit-name")
                    Picker("Sport", selection: $model.sport) {
                        ForEach(ActivityCategory.allCases) { category in
                            Section(category.name) {
                                ForEach(category.sportTypes) { sport in Text(sport.rawValue).tag(sport) }
                            }
                        }
                    }
                    .accessibilityIdentifier("activity-edit-sport")
                } header: { Text("Activity") }
                Section("Description") {
                    TextField("Description", text: $model.description, axis: .vertical)
                        .lineLimit(4...12)
                        .accessibilityLabel("Description")
                        .accessibilityIdentifier("activity-edit-description")
                }
                .disabled(model.isSaving)
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
                    if model.isSaving {
                        ProgressView("Saving to Strava…").accessibilityIdentifier("activity-edit-saving")
                    }
                } footer: { Text("Saving updates this activity in Strava.") }
            }
            .disabled(model.isSaving)
            .navigationTitle("Edit activity")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", role: .cancel) { cancel() }
                        .disabled(model.isSaving)
                        .accessibilityIdentifier("activity-edit-cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
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
                    }
                    .disabled(!model.canSave(now: currentTime) || service.unavailableReason != nil)
                    .accessibilityIdentifier("activity-edit-save")
                }
            }
            .confirmationDialog("Discard your changes?", isPresented: $showsDiscardConfirmation, titleVisibility: .visible) {
                Button("Discard changes", role: .destructive) { dismiss() }
                Button("Keep editing", role: .cancel) {}
            }
            .interactiveDismissDisabled(model.isDirty || model.isSaving)
            .accessibilityAction(.escape) { cancel() }
        }
        .task(id: model.retryAt) {
            guard let deadline = model.retryAt else { return }
            do { try await Task.sleep(for: .seconds(max(0, deadline.timeIntervalSinceNow))) }
            catch { return }
            currentTime = Date()
        }
    }

    private func cancel() {
        guard !model.isSaving else { return }
        if model.isDirty { showsDiscardConfirmation = true }
        else { dismiss() }
    }
}

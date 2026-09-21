import SwiftUI

struct AccountSheet: View {
    let destination: AccountDestination

    @Environment(\.dismiss) private var dismiss
    @State private var distanceUnit = DistanceUnit.kilometers
    @State private var appearance = Appearance.system
    @State private var automaticallySyncs = true

    var body: some View {
        NavigationStack {
            Form {
                switch destination {
                case .profile:
                    profileContent
                case .settings:
                    settingsContent
                case .about:
                    aboutContent
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private var profileContent: some View {
        Section {
            VStack(spacing: 12) {
                Image(systemName: "person.crop.circle.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(.secondary)

                VStack(spacing: 3) {
                    Text("Dominik")
                        .font(.headline)
                    Text("ActivityMap account")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity)
            .listRowBackground(Color.clear)
        }

        Section("Connected Services") {
            LabeledContent("Strava", value: "Connected")
            LabeledContent("Last Sync", value: "Just now")
        }
    }

    private var settingsContent: some View {
        Group {
            Section("Activity Data") {
                Toggle("Sync Automatically", isOn: $automaticallySyncs)
                NavigationLink("Connected Services") {
                    Text("Connected services will appear here.")
                        .navigationTitle("Connected Services")
                }
            }

            Section("Display") {
                Picker("Distance", selection: $distanceUnit) {
                    ForEach(DistanceUnit.allCases) { unit in
                        Text(unit.title).tag(unit)
                    }
                }

                Picker("Appearance", selection: $appearance) {
                    ForEach(Appearance.allCases) { appearance in
                        Text(appearance.title).tag(appearance)
                    }
                }
            }
        }
    }

    private var aboutContent: some View {
        Group {
            Section {
                LabeledContent("Version", value: "1.0")
            }

            Section {
                Text("Explore your activities on a map, in a list, and through meaningful summaries.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var title: String {
        switch destination {
        case .profile: "Profile"
        case .settings: "Settings"
        case .about: "About"
        }
    }
}

private enum DistanceUnit: String, CaseIterable, Identifiable {
    case kilometers
    case miles

    var id: String { rawValue }

    var title: String {
        switch self {
        case .kilometers: "Kilometers"
        case .miles: "Miles"
        }
    }
}

private enum Appearance: String, CaseIterable, Identifiable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }
}

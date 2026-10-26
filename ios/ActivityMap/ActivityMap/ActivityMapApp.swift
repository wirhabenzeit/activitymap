import SwiftUI

@main
struct ActivityMapApp: App {
    @State private var displayPreferences = DisplayPreferences()
    private let isTesting = ProcessInfo.processInfo.arguments.contains("--unit-testing")
    private let persistence: Result<LocalStore, Error>
    #if DEBUG
    private let isPlacesUITesting = ProcessInfo.processInfo.arguments.contains("--places-ui-testing")
    private let isActivityActionsUITesting = ProcessInfo.processInfo.arguments.contains("--activity-actions-ui-testing")
    private let isMapRotationUITesting = ProcessInfo.processInfo.arguments.contains("--map-rotation-ui-testing")
    private let isMapPhotoUITesting = ProcessInfo.processInfo.arguments.contains("--map-photo-ui-testing")
    private let isListSelectionUITesting = ProcessInfo.processInfo.arguments.contains("--list-selection-ui-testing")
    private let isStatsUITesting = ProcessInfo.processInfo.arguments.contains("--stats-ui-testing")
    #endif

    init() {
        persistence = Result {
            try LocalStore(container: LocalStore.makeContainer(
                inMemory: Self.usesInMemoryPersistence))
        }
    }

    private static var usesInMemoryPersistence: Bool {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--places-ui-testing")
            || ProcessInfo.processInfo.arguments.contains("--activity-actions-ui-testing")
            || ProcessInfo.processInfo.arguments.contains("--map-rotation-ui-testing")
            || ProcessInfo.processInfo.arguments.contains("--map-photo-ui-testing")
            || ProcessInfo.processInfo.arguments.contains("--list-selection-ui-testing")
            || ProcessInfo.processInfo.arguments.contains("--stats-ui-testing") { return true }
        #endif
        return ProcessInfo.processInfo.arguments.contains("--unit-testing")
    }

    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if isPlacesUITesting {
                if ProcessInfo.processInfo.arguments.contains("--place-search-ui-testing") {
                    PlaceSearchUITestFixture()
                } else { PlacesUITestFixture() }
            } else if isActivityActionsUITesting {
                ActivityActionsUITestFixture()
            } else if isStatsUITesting {
                StatsUITestFixture()
            } else if isMapRotationUITesting {
                MapRotationUITestFixture(expanded: ProcessInfo.processInfo.arguments.contains("--map-rotation-expanded"))
            } else if isListSelectionUITesting {
                ListSelectionUITestFixture(standalone: ProcessInfo.processInfo.arguments.contains("--list-standalone"))
            } else if isMapPhotoUITesting {
                MapPhotoUITestFixture(resultsPresented: ProcessInfo.processInfo.arguments.contains("--map-photo-results"))
            } else {
                standardContent
            }
            #else
            standardContent
            #endif
        }
    }

    @ViewBuilder private var standardContent: some View {
        if isTesting {
            // Hosted tests must not restore a real session or initialize Mapbox.
            Color.clear
        } else {
            switch persistence {
            case .success(let store):
                ContentView().environment(\.localStore, store)
                    .environment(displayPreferences)
                    .preferredColorScheme(displayPreferences.appearance.colorScheme)
            case .failure:
                ContentUnavailableView(
                    "Couldn’t open saved activities", systemImage: "externaldrive.badge.exclamationmark",
                    description: Text("Restart the app to try again. Your saved data has not been erased."))
            }
        }
    }
}

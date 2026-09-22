import SwiftUI

@main
struct ActivityMapApp: App {
    private let isTesting = ProcessInfo.processInfo.arguments.contains("--unit-testing")
    private let persistence: Result<LocalStore, Error>

    init() {
        persistence = Result {
            try LocalStore(container: LocalStore.makeContainer(
                inMemory: ProcessInfo.processInfo.arguments.contains("--unit-testing")))
        }
    }

    var body: some Scene {
        WindowGroup {
            if isTesting {
                // Hosted tests must not restore a real session or initialize Mapbox.
                Color.clear
            } else {
                switch persistence {
                case .success(let store):
                    ContentView().environment(\.localStore, store)
                case .failure:
                    ContentUnavailableView(
                        "Couldn’t open saved activities", systemImage: "externaldrive.badge.exclamationmark",
                        description: Text("Restart the app to try again. Your saved data has not been erased."))
                }
            }
        }
    }
}

import SwiftUI

struct ContentView: View {
    var body: some View {
        AppShell(browsingDefaults: .standard)
    }
}

#Preview {
    AppShell(activities: SampleData.activities)
}

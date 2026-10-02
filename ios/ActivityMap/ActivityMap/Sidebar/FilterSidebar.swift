import SwiftUI

/// The older sidebar uses the same complete editor as the current sheet.
struct FilterSidebar: View {
    @Bindable var store: ActivityStore
    var body: some View { FilterPanel(store: store) }
}

private struct FilterSidebarVisibleKey: EnvironmentKey {
    static let defaultValue = false
}
extension EnvironmentValues {
    var filterSidebarVisible: Bool {
        get { self[FilterSidebarVisibleKey.self] }
        set { self[FilterSidebarVisibleKey.self] = newValue }
    }
}

import SwiftUI

/// The shell owns sidebar visibility; List uses it to choose its detail host.
private struct FilterSidebarVisibleKey: EnvironmentKey {
    static let defaultValue = false
}
extension EnvironmentValues {
    var filterSidebarVisible: Bool {
        get { self[FilterSidebarVisibleKey.self] }
        set { self[FilterSidebarVisibleKey.self] = newValue }
    }
}

import Foundation

/// App resources stay localizable across retained controller state; remote
/// messages and activity content are verbatim. Resolve only at the display edge.
nonisolated enum PresentationText: Equatable, Sendable {
    case localized(LocalizedStringResource)
    case verbatim(String)

    func string(locale: Locale = .current) -> String {
        switch self {
        case .localized(var resource):
            resource.locale = locale
            return String(localized: resource)
        case .verbatim(let value): return value
        }
    }
}

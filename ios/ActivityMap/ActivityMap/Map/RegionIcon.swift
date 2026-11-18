import SwiftUI
import UIKit

/// Menu icon for a map catalogue region: the country's flag, or a globe for
/// worldwide groups. Menus only accept images, so the flag emoji is rendered
/// once into a full-colour bitmap that keeps the SF Symbol icon footprint.
enum RegionIcon {
    @MainActor private static var cache: [String: UIImage] = [:]

    @MainActor static func image(country: String?) -> Image {
        guard let country, let flag = flag(country) else { return Image(systemName: "globe") }
        if let cached = cache[country] { return Image(uiImage: cached).renderingMode(.original) }
        let font = UIFont.systemFont(ofSize: 20)
        let text = flag as NSString
        let size = text.size(withAttributes: [.font: font])
        let image = UIGraphicsImageRenderer(size: size).image { _ in
            text.draw(at: .zero, withAttributes: [.font: font])
        }.withRenderingMode(.alwaysOriginal)
        cache[country] = image
        return Image(uiImage: image).renderingMode(.original)
    }

    /// ISO 3166-1 alpha-2 code to its regional-indicator flag emoji.
    static func flag(_ country: String) -> String? {
        let scalars = country.uppercased().unicodeScalars
        guard scalars.count == 2, scalars.allSatisfy({ ("A"..."Z").contains($0) }) else { return nil }
        return String(String.UnicodeScalarView(scalars.compactMap { UnicodeScalar(127_397 + $0.value) }))
    }
}

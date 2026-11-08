import SwiftUI

enum MapMarkerPalette {
    // Keep geographic markers legible on both light and dark map styles.
    static let ink = Color(white: 0.15)
}

/// Photos and place groups share their visual size, count badge and tap target.
struct MapMarkerPin<Content: View>: View {
    let count: Int
    var thumbnails = false
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .frame(width: thumbnails ? 36 : 28, height: thumbnails ? 36 : 28)
            .background(MapMarkerPalette.ink, in: RoundedRectangle(cornerRadius: thumbnails ? 6 : 14))
            .overlay { RoundedRectangle(cornerRadius: thumbnails ? 6 : 14).stroke(.white, lineWidth: 1.5) }
            .overlay(alignment: .topTrailing) {
                if count > 1 {
                    Text("\(count)").font(.system(size: 9, weight: .semibold)).monospacedDigit()
                        .padding(.horizontal, 4).frame(minWidth: 16, minHeight: 16)
                        .background(MapMarkerPalette.ink, in: Capsule())
                        .overlay { Capsule().stroke(.white, lineWidth: 1) }
                        .offset(x: 4, y: -4)
                }
            }
            .foregroundStyle(.white).shadow(color: .black.opacity(0.3), radius: 3, y: 1)
            .frame(width: 44, height: 44).contentShape(Rectangle())
    }
}

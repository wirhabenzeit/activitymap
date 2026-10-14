import SwiftUI

struct MapPhotoMarker: View {
    let store: ActivityStore
    let photo: Photo
    let count: Int
    let thumbnails: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            ZStack {
                if thumbnails {
                    PhotoImageView(cache: store.photoImages, photo: photo, use: .thumbnail)
                        .frame(width: 34, height: 34)
                        .clipShape(RoundedRectangle(cornerRadius: 5))
                } else {
                    Image(systemName: "camera.fill").font(.system(size: 13))
                }
            }
            .frame(width: thumbnails ? 36 : 28, height: thumbnails ? 36 : 28)
            .background(Color(white: 0.15), in: RoundedRectangle(cornerRadius: thumbnails ? 6 : 14))
            .overlay { RoundedRectangle(cornerRadius: thumbnails ? 6 : 14).stroke(.white, lineWidth: 1.5) }
            .overlay(alignment: .topTrailing) {
                if count > 1 {
                    Text("\(count)").font(.system(size: 9, weight: .semibold)).monospacedDigit()
                        .padding(.horizontal, 4).frame(minWidth: 16, minHeight: 16)
                        .background(Color(white: 0.15), in: Capsule())
                        .overlay { Capsule().stroke(.white, lineWidth: 1) }
                        .offset(x: 4, y: -4)
                }
            }
            .foregroundStyle(.white).shadow(color: .black.opacity(0.3), radius: 3, y: 1)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(!thumbnails && count > 1 ? "Zoom into \(count) photos" :
            "View \(count > 1 ? "\(count) photos" : "photo"): \(Int(photo.activityID).flatMap { store.activity(id: $0)?.name } ?? "Activity")")
        .accessibilityIdentifier("map-photo-\(photo.id)")
    }
}

struct MapPhotoPresentation: Identifiable {
    let id: String
    let activityID: Int
    let nearbyPhotoIDs: Set<String>
}

/// A phone results sheet owns presentation while it is on screen.
struct StackedMapPhotoViewer {
    let request: Binding<MapPhotoPresentation?>
    let content: (MapPhotoPresentation) -> AnyView
    let onDismiss: () -> Void
}

import SwiftUI

struct MapPhotoMarker: View {
    let store: ActivityStore
    let photo: Photo
    let count: Int
    let thumbnails: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            MapMarkerPin(count: count, thumbnails: thumbnails) {
                if thumbnails {
                    PhotoImageView(cache: store.photoImages, photo: photo, use: .thumbnail)
                        .frame(width: 34, height: 34)
                        .clipShape(RoundedRectangle(cornerRadius: 5))
                } else {
                    Image(systemName: "camera.fill").font(.system(size: 13))
                }
            }
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

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
                        .frame(width: 48, height: 48)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                } else {
                    Image(systemName: "camera.fill").font(.system(size: 18))
                }
            }
            .frame(width: thumbnails ? 52 : 44, height: thumbnails ? 52 : 44)
            .background(Color(white: 0.15), in: RoundedRectangle(cornerRadius: thumbnails ? 10 : 22))
            .overlay { RoundedRectangle(cornerRadius: thumbnails ? 10 : 22).stroke(.white, lineWidth: 2) }
            .overlay(alignment: .topTrailing) {
                if count > 1 {
                    Text("\(count)").font(.system(size: 10, weight: .semibold)).monospacedDigit()
                        .padding(.horizontal, 5).frame(minWidth: 20, minHeight: 20)
                        .background(Color(white: 0.15), in: Capsule())
                        .overlay { Capsule().stroke(.white, lineWidth: 1) }
                        .offset(x: 6, y: -6)
                }
            }
            .foregroundStyle(.white).shadow(color: .black.opacity(0.3), radius: 4, y: 2)
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
    let photoIDs: Set<String>
}

/// A phone results sheet owns presentation while it is on screen.
struct StackedMapPhotoViewer {
    let request: Binding<MapPhotoPresentation?>
    let content: (MapPhotoPresentation) -> AnyView
    let onDismiss: () -> Void
}

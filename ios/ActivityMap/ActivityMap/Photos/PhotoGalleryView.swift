import SwiftUI
import UIKit

struct PhotoGalleryView: View {
    let store: ActivityStore
    let activityID: Int
    @State private var invokingPhoto: String?
    @State private var presentation: Presentation?
    @AccessibilityFocusState private var focusedPhoto: String?
    private struct Presentation: Identifiable { let id: String }
    private var photos: [Photo] { Photo.ordered(store.photos.filter { $0.activityID == String(activityID) }) }

    var body: some View {
        if !photos.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Divider()
                Label("Photos", systemImage: "photo")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AppTheme.secondaryText)
                    .accessibilityAddTraits(.isHeader)
                ScrollView(.horizontal) {
                    LazyHStack(spacing: 8) {
                        ForEach(Array(photos.enumerated()), id: \.element.id) { index, photo in
                            Button { invokingPhoto = photo.id; presentation = Presentation(id: photo.id) } label: {
                                PhotoImageView(cache: store.photoImages, photo: photo, use: .thumbnail)
                                    .frame(width: 88, height: 88).clipped().clipShape(RoundedRectangle(cornerRadius: 8))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("View photo \(index + 1) of \(photos.count)\(photo.caption.map { ": \($0)" } ?? "")")
                            .accessibilityFocused($focusedPhoto, equals: photo.id)
                            .accessibilityIdentifier("photo-thumbnail-\(photo.id)")
                        }
                    }
                }
            }
            .fullScreenCover(item: $presentation, onDismiss: {
                // The opening button remains the focus return target.
                focusedPhoto = invokingPhoto
            }) { selected in
                PhotoViewer(store: store, activityID: activityID, initialPhotoID: selected.id)
            }
            .onChange(of: store.mapContext.scopeRevision) { _, _ in presentation = nil }
        }
    }
}

struct PhotoViewer: View {
    let store: ActivityStore
    let activityID: Int
    @State private var captionHeight: CGFloat = 24
    @State private var currentID: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var photos: [Photo] { Photo.ordered(store.photos.filter { $0.activityID == String(activityID) }) }
    private var index: Int { photos.firstIndex { $0.id == currentID } ?? 0 }
    private var current: Photo? { photos.first { $0.id == currentID } }

    init(store: ActivityStore, activityID: Int, initialPhotoID: String) {
        self.store = store
        self.activityID = activityID
        _currentID = State(initialValue: initialPhotoID)
    }

    var body: some View {
        GeometryReader { geometry in
            VStack(spacing: 12) {
                HStack(spacing: 12) {
                    Text(store.activity(id: activityID)?.name ?? "Activity photos")
                        .font(.subheadline.weight(.medium)).lineLimit(2)
                    Spacer(minLength: 0)
                    Button { dismiss() } label: {
                        Image(systemName: "xmark").frame(width: 44, height: 44)
                            .background(.white.opacity(0.15), in: Circle())
                    }
                    .accessibilityLabel("Close photo viewer")
                    .accessibilityIdentifier("photo-viewer-close")
                }
                TabView(selection: $currentID) {
                    ForEach(photos) { photo in
                        Group {
                            if photo.id == currentID {
                                PhotoImageView(cache: store.photoImages, photo: photo, use: .full)
                            } else { Color.clear }
                        }
                        .tag(photo.id)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .accessibilityLabel("Photo \(index + 1) of \(photos.count)")
                .accessibilityAdjustableAction { direction in
                    switch direction {
                    case .increment: go(1)
                    case .decrement: go(-1)
                    @unknown default: break
                    }
                }
                VStack(spacing: 8) {
                    HStack(spacing: 24) {
                        if photos.count > 1 {
                            Button { go(-1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                                .disabled(index == 0).accessibilityLabel("Previous photo")
                        }
                        Text("\(index + 1) of \(photos.count)")
                            .font(.subheadline).monospacedDigit()
                            .accessibilityIdentifier("photo-viewer-count")
                        if photos.count > 1 {
                            Button { go(1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                                .disabled(index >= photos.count - 1).accessibilityLabel("Next photo")
                        }
                    }
                    if let caption = current?.caption?.trimmingCharacters(in: .whitespacesAndNewlines), !caption.isEmpty {
                        ScrollView {
                            Text(caption).font(.body).frame(maxWidth: .infinity).multilineTextAlignment(.center)
                                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { captionHeight = $0 }
                        }
                        .frame(height: min(captionHeight, geometry.size.height * 0.2))
                        .accessibilityIdentifier("photo-viewer-caption")
                    }
                }
            }
            .padding(16)
            .foregroundStyle(.white)
            .background(Color.black.ignoresSafeArea())
            .preferredColorScheme(.dark)
            .buttonStyle(.plain)
            .accessibilityAction(.escape) { dismiss() }
            .onChange(of: currentID) { _, _ in
                if UIAccessibility.isVoiceOverRunning {
                    let caption = current?.caption?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    UIAccessibility.post(notification: .announcement, argument: "Photo \(index + 1) of \(photos.count). \(caption)")
                }
            }
            .onChange(of: photos.map(\.id)) { _, ids in if !ids.contains(currentID) { dismiss() } }
            .onChange(of: store.activitiesRevision) { _, _ in if store.activity(id: activityID) == nil { dismiss() } }
            .onChange(of: store.mapContext.scopeRevision) { _, _ in dismiss() }
        }
    }

    private func go(_ delta: Int) {
        guard photos.indices.contains(index + delta) else { return }
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { currentID = photos[index + delta].id }
    }
}

struct PhotoImageView: View {
    let cache: PhotoImageCache
    let photo: Photo
    let use: Photo.ImageUse
    @State private var image: UIImage?
    @State private var failed = false
    @State private var attempt = 0

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                if let image {
                    Image(uiImage: image).resizable()
                        .aspectRatio(contentMode: use == .thumbnail ? .fill : .fit)
                        .frame(width: geometry.size.width, height: geometry.size.height)
                        .clipped().accessibilityHidden(true)
                } else if failed || photo.variant(use) == nil {
                    VStack(spacing: 12) {
                        Image(systemName: "photo.badge.exclamationmark")
                        if use == .full {
                            Text("Photo unavailable").font(.headline)
                            Text("Reconnect or retry to load this image.").font(.subheadline).multilineTextAlignment(.center)
                            if photo.variant(use) != nil {
                                Button("Retry") { attempt += 1 }.frame(minHeight: 44)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.white.opacity(0.1))
                } else {
                    ProgressView().tint(.white).frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(.white.opacity(0.1)).accessibilityLabel("Loading photo")
                }
            }
        }
        // A new URL or reconciled cache invalidates the prior rendered image too.
        .task(id: StoreScope.key([cache.revision.uuidString, photo.variant(use)?.url.absoluteString ?? "", String(attempt)])) {
            image = nil
            failed = false
            do {
                let result = try await cache.image(photo: photo, use: use)
                try Task.checkCancellation()
                image = result
            } catch {
                if !Task.isCancelled { failed = true }
            }
        }
    }
}

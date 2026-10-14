import SwiftUI
import UIKit

struct PhotoGalleryView: View {
    let store: ActivityStore
    let activityID: Int
    @State private var invokingPhoto: String?
    @State private var presentation: Presentation?
    @AccessibilityFocusState private var focusedPhoto: String?
    @Namespace private var photoTransition
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
                            .matchedTransitionSource(id: photo.id, in: photoTransition)
                        }
                    }
                }
            }
            .fullScreenCover(item: $presentation, onDismiss: {
                // The opening button remains the focus return target.
                focusedPhoto = invokingPhoto
            }) { selected in
                PhotoViewer(store: store, activityID: activityID, initialPhotoID: selected.id,
                            transitionNamespace: photoTransition)
            }
            .onChange(of: store.mapContext.scopeRevision) { _, _ in presentation = nil }
        }
    }
}

struct PhotoViewer: View {
    let store: ActivityStore
    let activityID: Int
    let transitionNamespace: Namespace.ID?
    let transitionSourceID: String?
    let nearbyPhotoIDs: Set<String>
    let requiresVisibleActivity: Bool
    @State private var galleryActivityID: Int
    let onViewActivity: ((Int) -> Void)?
    @State private var currentID: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var photos: [Photo] {
        guard !requiresVisibleActivity || store.visibleActivityIDs.contains(galleryActivityID) else { return [] }
        return Photo.ordered(store.photos.filter { $0.activityID == String(galleryActivityID) })
    }
    private struct NearbyActivity: Identifiable { let id: Int; let photoID: String }
    private var nearbyActivities: [NearbyActivity] {
        var seen = Set<Int>()
        return Photo.ordered(store.photos.filter { nearbyPhotoIDs.contains($0.id) }).compactMap { photo in
            guard let id = Int(photo.activityID), store.visibleActivityIDs.contains(id), seen.insert(id).inserted else { return nil }
            return NearbyActivity(id: id, photoID: photo.id)
        }
    }
    private var currentActivityID: Int { galleryActivityID }
    private var index: Int { photos.firstIndex { $0.id == currentID } ?? 0 }
    private var current: Photo? { photos.first { $0.id == currentID } }
    private var neighbors: [Photo] {
        photos.enumerated().compactMap { position, photo in
            abs(position - index) == 1 ? photo : nil
        }
    }

    init(store: ActivityStore, activityID: Int, initialPhotoID: String, transitionNamespace: Namespace.ID? = nil, transitionSourceID: String? = nil, nearbyPhotoIDs: Set<String> = [], requiresVisibleActivity: Bool = false, onViewActivity: ((Int) -> Void)? = nil) {
        self.store = store
        self.activityID = activityID
        self.transitionNamespace = transitionNamespace
        self.transitionSourceID = transitionSourceID
        self.nearbyPhotoIDs = nearbyPhotoIDs
        self.requiresVisibleActivity = requiresVisibleActivity
        _galleryActivityID = State(initialValue: activityID)
        self.onViewActivity = onViewActivity
        _currentID = State(initialValue: initialPhotoID)
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                TabView(selection: $currentID) {
                    ForEach(Array(photos.enumerated()), id: \.element.id) { position, photo in
                        PhotoImageView(cache: store.photoImages, photo: photo, use: .full,
                                       loadsImage: abs(position - index) <= 1,
                                       isCurrent: photo.id == currentID)
                            // Expand the page stride, retaining full-width images at rest.
                            .padding(.horizontal, 8)
                            .tag(photo.id)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .padding(.horizontal, -8)
                .ignoresSafeArea()
                // Prepare both destinations before the native page drag commits.
                .task(id: StoreScope.key([store.photoImages.revision.uuidString, currentID] + neighbors.map {
                    StoreScope.key([$0.id, $0.variant(.full)?.url.absoluteString ?? ""])
                })) {
                    let cache = store.photoImages
                    await withTaskGroup(of: Void.self) { group in
                        for photo in neighbors {
                            group.addTask { _ = try? await cache.image(photo: photo, use: .full) }
                        }
                    }
                }
                .accessibilityLabel("Photo \(index + 1) of \(photos.count)")
                .accessibilityAdjustableAction { direction in
                    switch direction {
                    case .increment: go(1)
                    case .decrement: go(-1)
                    @unknown default: break
                    }
                }
            }
            .overlay(alignment: .top) {
                HStack(spacing: 12) {
                    activityHeading
                    Spacer(minLength: 0)
                    if let onViewActivity {
                        Button("View activity") { onViewActivity(currentActivityID); dismiss() }
                            .font(.subheadline).padding(.horizontal, 12).frame(minHeight: 44)
                            .background(.black.opacity(0.55), in: Capsule())
                    }
                    Button { dismiss() } label: { floatingIcon("xmark") }
                        .accessibilityLabel("Close photo viewer")
                        .accessibilityIdentifier("photo-viewer-close")
                }
                .padding(16)
            }
            .overlay {
                if photos.count > 1 {
                    HStack {
                        Button { go(-1) } label: { floatingIcon("chevron.left") }
                            .disabled(index == 0).accessibilityLabel("Previous photo")
                        Spacer()
                        Button { go(1) } label: { floatingIcon("chevron.right") }
                            .disabled(index >= photos.count - 1).accessibilityLabel("Next photo")
                    }
                    .padding(.horizontal, 16)
                }
            }
            .overlay(alignment: .bottom) {
                VStack(spacing: 8) {
                    let caption = current?.caption?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    if !caption.isEmpty {
                        // Caption layout changes only the overlay, never the pager.
                        Text(caption).font(.subheadline).multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity).fixedSize(horizontal: false, vertical: true)
                            .hidden().accessibilityHidden(true)
                            .frame(maxHeight: geometry.size.height * 0.2).clipped()
                            .overlay {
                                ScrollView {
                                    Text(caption).font(.subheadline).multilineTextAlignment(.center)
                                        .frame(maxWidth: .infinity)
                                }
                                .scrollBounceBehavior(.basedOnSize)
                            }
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("photo-viewer-caption")
                    }
                    Text("\(index + 1) of \(photos.count)")
                        .font(.subheadline).monospacedDigit()
                        .accessibilityIdentifier("photo-viewer-count")
                }
                .padding(12)
                .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 16))
                .padding(16)
            }
            .foregroundStyle(.white)
            .background(Color(white: 18.0 / 255).ignoresSafeArea())
            .preferredColorScheme(.dark)
            .statusBarHidden(true)
            .buttonStyle(.plain)
            .accessibilityAction(.escape) { dismiss() }
            .onChange(of: currentID) { _, _ in
                if UIAccessibility.isVoiceOverRunning {
                    let caption = current?.caption?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    UIAccessibility.post(notification: .announcement, argument: "Photo \(index + 1) of \(photos.count). \(caption)")
                }
            }
            .onChange(of: photos.map(\.id)) { _, ids in if !ids.contains(currentID) { dismiss() } }
            .onChange(of: store.activitiesRevision) { _, _ in if store.activity(id: currentActivityID) == nil { dismiss() } }
            .onChange(of: store.mapContext.scopeRevision) { _, _ in dismiss() }
        }
        // A results/detail sheet may disable its own drag dismissal. Photos
        // keep the shared native zoom transition's interactive dismissal.
        .interactiveDismissDisabled(false)
        .modifier(PhotoViewerZoomTransition(sourceID: transitionSourceID ?? currentID, namespace: transitionNamespace))
    }

    @ViewBuilder private var activityHeading: some View {
        if nearbyActivities.count > 1 {
            Menu {
                Section("Nearby activities") {
                    ForEach(nearbyActivities) { activity in
                        Button {
                            galleryActivityID = activity.id
                            currentID = activity.photoID
                        } label: {
                            Label(store.activity(id: activity.id)?.name ?? "Activity photos",
                                  systemImage: galleryActivityID == activity.id ? "checkmark" : "photo")
                        }
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Text(store.activity(id: currentActivityID)?.name ?? "Activity photos").lineLimit(1)
                    Image(systemName: "chevron.down").font(.caption)
                }
                .font(.subheadline.weight(.medium))
                .padding(.horizontal, 12).frame(minHeight: 44)
                .background(.black.opacity(0.55), in: Capsule())
            }
            .accessibilityLabel("Photo activity")
            .accessibilityValue(store.activity(id: currentActivityID)?.name ?? "Activity photos")
        } else {
            Text(store.activity(id: currentActivityID)?.name ?? "Activity photos")
                .font(.subheadline.weight(.medium)).lineLimit(1)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(.black.opacity(0.55), in: Capsule())
        }
    }

    private func floatingIcon(_ name: String) -> some View {
        Image(systemName: name).frame(width: 44, height: 44)
            .background(.black.opacity(0.55), in: Circle())
    }

    private func go(_ delta: Int) {
        guard photos.indices.contains(index + delta) else { return }
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { currentID = photos[index + delta].id }
    }
}

private struct PhotoViewerZoomTransition: ViewModifier {
    let sourceID: String
    let namespace: Namespace.ID?

    @ViewBuilder func body(content: Content) -> some View {
        if let namespace {
            content.navigationTransition(.zoom(sourceID: sourceID, in: namespace))
        } else {
            content
        }
    }
}

struct PhotoImageView: View {
    let cache: PhotoImageCache
    let photo: Photo
    let use: Photo.ImageUse
    var loadsImage = true
    var isCurrent = true
    @State private var image: UIImage?
    @State private var failed = false
    @State private var attempt = 0

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                if !loadsImage {
                    Color.clear
                } else if let image {
                    if use == .full {
                        ZoomablePhoto(image: image, isCurrent: isCurrent)
                            .frame(width: geometry.size.width, height: geometry.size.height)
                    } else {
                        Image(uiImage: image).resizable().aspectRatio(contentMode: .fill)
                            .frame(width: geometry.size.width, height: geometry.size.height)
                            .clipped().accessibilityHidden(true)
                    }
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
        .task(id: StoreScope.key([cache.revision.uuidString, photo.id, photo.variant(use)?.url.absoluteString ?? "", String(attempt), String(loadsImage)])) {
            image = nil
            failed = false
            guard loadsImage else { return }
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

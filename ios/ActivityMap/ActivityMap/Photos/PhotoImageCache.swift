import CryptoKit
import Foundation
import ImageIO
import Observation
import UIKit

/// The byte store owns disk/network work and fences every suspended request.
actor PhotoByteCache {
    struct Entry: Codable {
        let photoID: String
        let url: String
        let bytes: Int
        var accessedAt: Date
    }
    enum Failure: Error { case unavailable, oversized, obsolete }
    private let root: URL
    private let budget: Int
    private let fileLimit: Int
    private let fetch: @Sendable (URL) async throws -> Data
    private var revision = UUID()
    private var directory: URL?
    private var allowed: Set<String> = []
    private var entries: [String: Entry] = [:]

    init(root: URL = URL.cachesDirectory.appending(path: "ActivityMapPhotos", directoryHint: .isDirectory),
         budget: Int = 64 * 1024 * 1024, fileLimit: Int = 12 * 1024 * 1024,
         fetch: @escaping @Sendable (URL) async throws -> Data = PhotoByteCache.download) {
        self.root = root
        self.budget = budget
        self.fileLimit = fileLimit
        self.fetch = fetch
    }

    nonisolated static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    nonisolated static func key(photoID: String, url: URL) -> String {
        digest(StoreScope.key([photoID, url.absoluteString]))
    }
    nonisolated static func download(_ url: URL) async throws -> Data {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 45
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let (file, response) = try await session.download(from: url)
        defer { try? FileManager.default.removeItem(at: file) }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw Failure.unavailable }
        let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 12 * 1024 * 1024 else { throw Failure.oversized }
        return try Data(contentsOf: file)
    }

    /// Reconciliation includes snapshots/rebootstrap, changed URLs and removals.
    func configure(scope: StoreScope?, photos: [Photo], revision: UUID) throws {
        self.revision = revision
        directory = nil
        entries = [:]
        allowed = Set(photos.flatMap { photo in
            photo.urls.values.compactMap { raw -> String? in
                guard let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
                      ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else { return nil }
                return Self.key(photoID: photo.id, url: url)
            }
        })
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let active = scope.map { Self.digest($0.key) }
        for url in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) where url.lastPathComponent != active {
            try FileManager.default.removeItem(at: url)
        }
        guard let active else { return }
        let folder = root.appending(path: active, directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var protectedFolder = folder
        try protectedFolder.setResourceValues(values)
        directory = folder
        if let data = try? Data(contentsOf: folder.appending(path: "index.json")),
           let saved = try? JSONDecoder().decode([String: Entry].self, from: data) {
            entries = saved.filter { allowed.contains($0.key) }
        }
        // Remove files absent from metadata or an unreadable manifest.
        for url in try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            where url.lastPathComponent != "index.json" && entries[url.lastPathComponent] == nil {
            try FileManager.default.removeItem(at: url)
        }
        try evict()
        try save()
    }

    func data(photoID: String, url: URL, revision expected: UUID) async throws -> Data {
        let key = Self.key(photoID: photoID, url: url)
        guard revision == expected, allowed.contains(key), let directory else { throw Failure.obsolete }
        let file = directory.appending(path: key)
        if var entry = entries[key], let cached = try? Data(contentsOf: file), cached.count <= fileLimit {
            entry.accessedAt = Date()
            entries[key] = entry
            try? save()
            return cached
        }
        let data = try await fetch(url)
        try Task.checkCancellation()
        guard revision == expected, allowed.contains(key), self.directory == directory else { throw Failure.obsolete }
        guard data.count <= fileLimit else { throw Failure.oversized }
        try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        entries[key] = Entry(photoID: photoID, url: url.absoluteString, bytes: data.count, accessedAt: Date())
        try evict()
        try save()
        return data
    }

    func remove(photoID: String, url: URL) throws {
        let key = Self.key(photoID: photoID, url: url)
        entries.removeValue(forKey: key)
        if let directory { try? FileManager.default.removeItem(at: directory.appending(path: key)) }
        try save()
    }

    private func evict() throws {
        var total = entries.values.reduce(0) { $0 + $1.bytes }
        for (key, entry) in entries.sorted(by: { $0.value.accessedAt < $1.value.accessedAt }) where total > budget {
            if let directory { try? FileManager.default.removeItem(at: directory.appending(path: key)) }
            entries.removeValue(forKey: key)
            total -= entry.bytes
        }
    }
    private func save() throws {
        guard let directory else { return }
        try JSONEncoder().encode(entries).write(to: directory.appending(path: "index.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

@MainActor
@Observable
final class PhotoImageCache {
    private let bytes: PhotoByteCache
    private let memory = NSCache<NSString, UIImage>()
    private(set) var revision = UUID()
    private var allowed: Set<String> = []

    init(bytes: PhotoByteCache = PhotoByteCache()) {
        self.bytes = bytes
        memory.totalCostLimit = 16 * 1024 * 1024
    }

    func configure(scope: StoreScope?, photos: [Photo]) async throws {
        revision = UUID()
        memory.removeAllObjects()
        allowed = Set(photos.map(\.id))
        try await bytes.configure(scope: scope, photos: photos, revision: revision)
    }

    /// Clear presentation synchronously; pending requests cannot publish after this.
    func reset() {
        revision = UUID()
        allowed = []
        memory.removeAllObjects()
        let current = revision
        Task { try? await bytes.configure(scope: nil, photos: [], revision: current) }
    }

    func image(photo: Photo, use: Photo.ImageUse) async throws -> UIImage {
        guard allowed.contains(photo.id), let variant = photo.variant(use) else { throw PhotoByteCache.Failure.unavailable }
        let current = revision
        let edge = use == .thumbnail ? 256 : 2048
        let key = "\(PhotoByteCache.key(photoID: photo.id, url: variant.url)):\(edge)" as NSString
        if let cached = memory.object(forKey: key) { return cached }
        let data = try await bytes.data(photoID: photo.id, url: variant.url, revision: current)
        try Task.checkCancellation()
        guard current == revision, allowed.contains(photo.id) else { throw PhotoByteCache.Failure.obsolete }
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let decoded = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceThumbnailMaxPixelSize: edge,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
              ] as CFDictionary) else {
            try? await bytes.remove(photoID: photo.id, url: variant.url)
            throw PhotoByteCache.Failure.unavailable
        }
        let image = UIImage(cgImage: decoded)
        memory.setObject(image, forKey: key, cost: decoded.bytesPerRow * decoded.height)
        return image
    }
}

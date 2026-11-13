import Foundation

nonisolated enum NativeSyncCapabilityError: Error { case unavailable }

nonisolated enum NativeSyncPolicy {
    static let pageTimeout: TimeInterval = 60
    static let capabilityTimeout: TimeInterval = 8
}

/// The connection only supplies pages and wakeups. SyncController remains the
/// single library writer and SyncEngine commits pages/checkpoints to SwiftData.
@MainActor
protocol NativeLibraryConnection: AnyObject {
    var pages: any SyncPageSource { get }
    func updates() -> AsyncThrowingStream<Void, Error>
    func close()
    func closeAndWait() async
}

extension NativeLibraryConnection {
    func closeAndWait() async { close() }
}

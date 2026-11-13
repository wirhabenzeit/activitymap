import Foundation

/// The connection only supplies pages and wakeups. SyncController remains the
/// single library writer and SyncEngine commits pages/checkpoints to SwiftData.
@MainActor
protocol NativeLibraryConnection: AnyObject {
    var pages: any SyncPageSource { get }
    func updates() -> AsyncThrowingStream<Void, Error>
    func close()
}

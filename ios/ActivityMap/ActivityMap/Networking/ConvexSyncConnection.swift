import Combine
@preconcurrency import ConvexMobile
import Foundation

nonisolated struct ConvexTokenProvider: AuthProvider, Sendable {
    struct Token: Decodable, Sendable { let token: String }
    let session: SyncSession
    var http: URLSession = .shared

    func login(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> Token {
        try await loginFromCache(onIdToken: onIdToken)
    }

    func loginFromCache(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> Token {
        do {
            // The SDK calls this again when its short-lived JWT needs renewal.
            // The app session stays in Keychain; JWTs only live in this connection.
            return try await APIClient.getUnwrapped("/api/auth/token", bearerToken: session.token,
                baseURL: session.deployment, session: http, timeout: 8, as: Token.self)
        } catch {
            if APIClient.errorFacts(for: error).authenticationRejected { onIdToken(nil) }
            throw error
        }
    }

    func extractIdToken(from authResult: Token) -> String { authResult.token }
    func logout() async throws {} // Closing this transport does not sign the app out.
}

@MainActor
final class ConvexSyncConnection: NativeLibraryConnection {
    nonisolated struct Head: Decodable, Equatable, Sendable { let version: String; let sequence: Double }
    enum ConnectionError: Error { case unavailable, closed }
    private let client: ConvexClientWithAuth<ConvexTokenProvider.Token>
    private var closed = false
    var pages: any SyncPageSource { ConvexSyncPages(connection: self) }

    private init(url: URL, session: SyncSession) {
        client = ConvexClientWithAuth(deploymentUrl: url.absoluteString, authProvider: ConvexTokenProvider(session: session))
    }

    static func connect(_ session: SyncSession) async throws -> (any NativeLibraryConnection)? {
        guard let configuration = try await APIClient.get("/api/v1/sync/native",
            bearerToken: session.token, baseURL: session.deployment, timeout: 8, as: ActivityMapAPI.NativeSyncConfiguration?.self),
            configuration.version == 1, let url = URL(string: configuration.url), url.scheme == "https",
            url.host != nil else { return nil }
        let connection = ConvexSyncConnection(url: url, session: session)
        do {
            _ = try await connection.client.loginFromCache().get()
            try Task.checkCancellation()
            // Capability probe handles either server being released first.
            let _: Head = try await connection.first(connection.client.subscribe(to: "nativeSync:head", yielding: Head.self))
            return connection
        } catch {
            connection.close()
            throw error
        }
    }

    func updates() -> AsyncThrowingStream<Void, Error> {
        Self.stream(client.subscribe(to: "nativeSync:head", yielding: Head.self)
            .removeDuplicates().map { @Sendable _ in () }.eraseToAnyPublisher())
    }

    func close() {
        guard !closed else { return }
        closed = true
        Task { await client.logout() }
    }

    func read(resource: String, cursor: String?) async throws -> String {
        guard !closed else { throw ConnectionError.closed }
        do {
            return try await first(client.subscribe(to: "nativeSync:read",
                with: ["resource": resource, "cursor": cursor], yielding: String.self))
        } catch ClientError.ConvexError(let data) where data == "\"sync_rebootstrap_required\"" {
            throw APIClient.RequestError.server(code: "sync_rebootstrap_required", message: "Reload the library.",
                status: 409, requestID: nil, retryable: true)
        }
    }

    private func first<T: Sendable>(_ publisher: AnyPublisher<T, ClientError>) async throws -> T {
        let values = Self.stream(publisher.first().timeout(.seconds(8), scheduler: DispatchQueue.global(),
            customError: { @Sendable in ClientError.InternalError(msg: "Native sync timed out") }).eraseToAnyPublisher())
        for try await value in values {
            try Task.checkCancellation()
            return value
        }
        throw ConnectionError.unavailable
    }

    // Rust invokes Combine callbacks off the main actor. Keeping this bridge
    // nonisolated and its callbacks Sendable avoids Swift 6 executor assertions.
    nonisolated static func stream<T: Sendable>(_ publisher: AnyPublisher<T, ClientError>) -> AsyncThrowingStream<T, Error> {
        AsyncThrowingStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            let lifetime = ConvexSubscriptionLifetime()
            continuation.onTermination = { _ in lifetime.cancel() }
            lifetime.install(publisher.sink(receiveCompletion: { @Sendable completion in
                switch completion {
                case .finished: continuation.finish()
                case .failure(let error): continuation.finish(throwing: error)
                }
            }, receiveValue: { @Sendable in continuation.yield($0) }))
        }
    }
}

/// Subscription callbacks and task cancellation may arrive on different queues.
nonisolated private final class ConvexSubscriptionLifetime: @unchecked Sendable {
    private let lock = NSLock()
    private var subscription: AnyCancellable?
    private var cancelled = false
    func install(_ subscription: AnyCancellable) {
        lock.lock()
        if cancelled { lock.unlock(); subscription.cancel(); return }
        self.subscription = subscription
        lock.unlock()
    }
    func cancel() {
        lock.lock()
        cancelled = true
        let previous = subscription
        subscription = nil
        lock.unlock()
        previous?.cancel()
    }
    deinit { cancel() }
}

nonisolated struct ConvexSyncPages: SyncPageSource {
    let connection: ConvexSyncConnection
    func accepts(cursor: String) -> Bool { cursor.hasPrefix("ios-convex-v1:") }
    func bootstrap(resource: ActivityMapAPI.SyncResource, cursor: String?) async throws -> ActivityMapAPI.SyncBootstrapPage {
        let json = try await connection.read(resource: resource.rawValue, cursor: cursor)
        return try ActivityMapAPI.makeDecoder().decode(ActivityMapAPI.SyncBootstrapPage.self, from: Data(json.utf8))
    }
    func changes(cursor: String) async throws -> ActivityMapAPI.SyncChangesPage {
        let json = try await connection.read(resource: "changes", cursor: cursor)
        return try ActivityMapAPI.makeDecoder().decode(ActivityMapAPI.SyncChangesPage.self, from: Data(json.utf8))
    }
}

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
    nonisolated private static let deadlines = DispatchQueue(label: "cc.activitymap.native-sync-deadlines")
    nonisolated struct Head: Decodable, Equatable, Sendable {
        let version: String
        let sequence: Double
        let lastSummaryReconciledAt: Double?
    }
    enum ConnectionError: Error { case unavailable, closed }
    private var client: ConvexClientWithAuth<ConvexTokenProvider.Token>?
    let subscriptions = ConvexSubscriptionBag()
    private var closed = false
    private var authenticationStarted = false
    private var shutdown: Task<Void, Never>?
    var pages: any SyncPageSource { ConvexSyncPages(connection: self) }

    private convenience init(url: URL, session: SyncSession) {
        self.init(client: ConvexClientWithAuth(deploymentUrl: url.absoluteString, authProvider: ConvexTokenProvider(session: session)))
    }

    init(client: ConvexClientWithAuth<ConvexTokenProvider.Token>) { self.client = client }

    static func connect(_ session: SyncSession) async throws -> (any NativeLibraryConnection)? {
        let configuration: ActivityMapAPI.NativeSyncConfiguration?
        do {
            configuration = try await APIClient.get("/api/v1/sync/native",
                bearerToken: session.token, baseURL: session.deployment, timeout: NativeSyncPolicy.capabilityTimeout,
                as: ActivityMapAPI.NativeSyncConfiguration?.self)
        } catch APIClient.RequestError.unexpectedStatus(404) {
            throw NativeSyncCapabilityError.unavailable
        }
        guard let configuration,
            configuration.version == 1, let url = URL(string: configuration.url), url.scheme == "https",
            url.host != nil else { return nil }
        let connection = ConvexSyncConnection(url: url, session: session)
        do {
            guard let client = connection.client else { throw CancellationError() }
            connection.authenticationStarted = true
            _ = try await client.loginFromCache().get()
            try Task.checkCancellation()
            // Capability probe handles either server being released first.
            let _: Head = try await Self.first(client.subscribe(to: "nativeSync:head", yielding: Head.self),
                timeout: NativeSyncPolicy.capabilityTimeout, subscriptions: connection.subscriptions)
            return connection
        } catch {
            connection.close()
            if case ClientError.ServerError(let message) = error,
               message.contains("Could not find public function") { throw NativeSyncCapabilityError.unavailable }
            throw error
        }
    }

    func updates() -> AsyncThrowingStream<Void, Error> {
        guard let client else { return AsyncThrowingStream { $0.finish(throwing: CancellationError()) } }
        let head = client.subscribe(to: "nativeSync:head", yielding: Head.self)
            .removeDuplicates().map { @Sendable _ in () }
        let reconnects = client.watchWebSocketState().filter { @Sendable state in
            if case .connected = state { return true }; return false
        }.map { @Sendable _ in () }.setFailureType(to: ClientError.self)
        return Self.stream(head.merge(with: reconnects).eraseToAnyPublisher(), subscriptions: subscriptions)
    }

    func close() {
        guard !closed else { return }
        closed = true
        // Cancel every retained subscription/read immediately. The SDK's auth
        // callback can retain its FFI client, so clear it before final release.
        subscriptions.close()
        let previous = client
        let clearAuthentication = authenticationStarted
        client = nil
        shutdown = Task {
            if clearAuthentication { await previous?.logout() }
            withExtendedLifetime(previous) {}
        }
    }

    func closeAndWait() async {
        close()
        await shutdown?.value
        shutdown = nil
    }

    func read(resource: String, cursor: String?) async throws -> String {
        guard !closed, let client else { throw ConnectionError.closed }
        do {
            return try await Self.first(client.subscribe(to: "nativeSync:read",
                with: ["resource": resource, "cursor": cursor], yielding: String.self), subscriptions: subscriptions)
        } catch ClientError.ConvexError(let data) where data == "\"sync_rebootstrap_required\"" {
            throw APIClient.RequestError.server(code: "sync_rebootstrap_required", message: "Reload the library.",
                status: 409, requestID: nil, retryable: true)
        }
    }

    nonisolated static func first<T: Sendable>(_ publisher: AnyPublisher<T, ClientError>,
        timeout: TimeInterval = NativeSyncPolicy.pageTimeout, subscriptions: ConvexSubscriptionBag? = nil) async throws -> T {
        let values = Self.stream(publisher.first().timeout(.seconds(timeout), scheduler: deadlines,
            customError: { @Sendable in ClientError.InternalError(msg: "Native sync timed out") }).eraseToAnyPublisher(), subscriptions: subscriptions)
        do {
            for try await value in values {
                try Task.checkCancellation()
                return value
            }
        } catch ClientError.InternalError {
            throw APIClient.RequestError.transport("Native sync connection interrupted")
        }
        throw APIClient.RequestError.transport("Native sync unavailable")
    }

    // Rust invokes Combine callbacks off the main actor. Keeping this bridge
    // nonisolated and its callbacks Sendable avoids Swift 6 executor assertions.
    nonisolated static func stream<T: Sendable>(_ publisher: AnyPublisher<T, ClientError>, subscriptions: ConvexSubscriptionBag? = nil) -> AsyncThrowingStream<T, Error> {
        AsyncThrowingStream(bufferingPolicy: .bufferingNewest(1)) { continuation in
            let id = UUID()
            let lifetime = ConvexSubscriptionLifetime { continuation.finish(throwing: CancellationError()) }
            continuation.onTermination = { _ in
                lifetime.cancel()
                subscriptions?.remove(id)
            }
            guard subscriptions?.insert(lifetime, id: id) != false else { lifetime.cancel(); return }
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
nonisolated final class ConvexSubscriptionLifetime: @unchecked Sendable {
    private let lock = NSLock()
    private var subscription: AnyCancellable?
    private var cancelled = false
    private var finish: (@Sendable () -> Void)?
    init(finish: @Sendable @escaping () -> Void) { self.finish = finish }
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
        let finish = finish
        self.finish = nil
        lock.unlock()
        previous?.cancel()
        finish?()
    }
    deinit { cancel() }
}

/// Owns cancellation independently of tasks that may still hold the connection.
nonisolated final class ConvexSubscriptionBag: @unchecked Sendable {
    private let lock = NSLock()
    private var closed = false
    private var active: [UUID: ConvexSubscriptionLifetime] = [:]
    func insert(_ lifetime: ConvexSubscriptionLifetime, id: UUID) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard !closed else { return false }
        active[id] = lifetime
        return true
    }
    func remove(_ id: UUID) { lock.lock(); active.removeValue(forKey: id); lock.unlock() }
    func close() {
        lock.lock()
        closed = true
        let previous = Array(active.values)
        active.removeAll()
        lock.unlock()
        previous.forEach { $0.cancel() }
    }
    deinit { close() }
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

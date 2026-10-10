import Foundation

nonisolated protocol InitialImportSource: Sendable {
    func read() async throws -> ActivityMapAPI.InitialImport
    func advance() async throws -> ActivityMapAPI.InitialImport
}

nonisolated struct InitialImportAPI: InitialImportSource {
    let baseURL: URL
    let token: String
    func read() async throws -> ActivityMapAPI.InitialImport {
        try await APIClient.get("/api/v1/initial-import", bearerToken: token, baseURL: baseURL,
                                as: ActivityMapAPI.InitialImport.self)
    }
    func advance() async throws -> ActivityMapAPI.InitialImport {
        try await APIClient.post("/api/v1/initial-import", bearerToken: token, baseURL: baseURL,
                                 as: ActivityMapAPI.InitialImport.self)
    }
}

extension ActivityMapAPI.InitialImport {
    var isFinished: Bool { phase == .ready || phase == .empty }
}

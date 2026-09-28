import Foundation

struct Vector: Decodable {
    let name: String
    let summary: ActivityMapAPI.StreamSummary
    let compact: ActivityMapAPI.CompactStreamSummary
}
let fixtureURL = URL(fileURLWithPath: CommandLine.arguments[1])
let vectors = try JSONDecoder().decode([Vector].self, from: Data(contentsOf: fixtureURL))
for vector in vectors {
    let encoded = try CompactStreamCodec.encode(vector.summary)
    precondition(encoded == vector.compact, vector.name)
    let decoded = try CompactStreamCodec.decode(vector.compact)
    precondition(decoded == vector.summary, vector.name)
    // Encoded cache bytes survive a disk write/reopen without materializing arrays.
    let data = try JSONEncoder().encode(encoded)
    let url = URL(fileURLWithPath: CommandLine.arguments[2])
    try data.write(to: url)
    let reopened = try JSONDecoder().decode(ActivityMapAPI.CompactStreamSummary.self, from: Data(contentsOf: url))
    precondition(reopened == encoded)
}
let base: [String: Any] = ["codec": "polyline-v1", "algorithm_version": 1, "basis": "distance", "count": 1, "distance": "?"]
let invalid: [[String: Any]] = [
    ["codec": "polyline-v2"], ["algorithm_version": 0], ["algorithm_version": -1], ["count": -1], ["count": 301],
    ["distance": ""], ["distance": "??"], ["distance": "_"], ["distance": "_?"],
    ["distance": "!"], ["distance": "é"], ["distance": String(repeating: "~", count: 10)],
    ["distance": String(repeating: "~", count: 8) + "^"], ["altitude": ""],
    ["basis": "time"], ["basis": NSNull()]
]
for change in invalid {
    let data = try JSONSerialization.data(withJSONObject: base.merging(change) { _, next in next })
    do {
        let summary = try JSONDecoder().decode(ActivityMapAPI.CompactStreamSummary.self, from: data)
        _ = try CompactStreamCodec.decode(summary)
        fatalError("Accepted malformed compact summary: \(change)")
    } catch { }
}
print("Swift compact codec: \(vectors.count) golden round trips, disk reopen and \(invalid.count) malformed cases passed")

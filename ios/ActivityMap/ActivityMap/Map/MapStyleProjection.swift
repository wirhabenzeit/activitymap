import Foundation

/// Projection is a native presentation choice; the shared style files remain
/// byte-identical to the web bundle. Resolve relative assets before loading
/// remote style JSON without its original style URL.
enum MapStyleProjection {
    static func globeJSON(_ json: String, relativeTo baseURL: URL? = nil) throws -> String {
        var style = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] ?? [:]
        style["projection"] = ["type": "globe"]
        if let baseURL {
            func resolve(_ value: String) -> String {
                guard URL(string: value)?.scheme == nil,
                      let url = URL(string: value, relativeTo: baseURL) else { return value }
                return url.absoluteString.replacingOccurrences(of: "%7B", with: "{")
                    .replacingOccurrences(of: "%7D", with: "}")
            }
            for key in ["sprite", "glyphs"] {
                if let value = style[key] as? String { style[key] = resolve(value) }
            }
            if var sources = style["sources"] as? [String: [String: Any]] {
                for (id, var source) in sources {
                    if let url = source["url"] as? String { source["url"] = resolve(url) }
                    if let tiles = source["tiles"] as? [String] { source["tiles"] = tiles.map(resolve) }
                    sources[id] = source
                }
                style["sources"] = sources
            }
        }
        return String(decoding: try JSONSerialization.data(withJSONObject: style, options: [.sortedKeys]), as: UTF8.self)
    }
}

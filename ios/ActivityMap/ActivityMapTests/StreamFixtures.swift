import Foundation
@testable import ActivityMap

nonisolated enum StreamFixtures {
    static let activityID = "9007199254740993"

    static func metadataJSON(
        generation: String? = "g1", revision: String = "1", state: String = "current",
        types: [String] = ["time", "distance", "latlng", "altitude", "watts", "heartrate"]
    ) -> String {
        let generationJSON = generation.map { "\"\($0)\"" } ?? "null"
        let typesJSON = types.map { "\"\($0)\"" }.joined(separator: ",")
        return """
        {"generation":\(generationJSON),"revision":"\(revision)","state":"\(state)",\
        "fetch_status":"succeeded","available_types":[\(typesJSON)],\
        "fetched_at":"2026-09-22T12:00:00.000Z","expires_at":null}
        """
    }

    /// All six streams, with extra per-stream metadata this build does not model
    /// and deliberately unequal lengths.
    static let sixStreams = """
    {"time":{"type":"time","data":[0,1,2,5],"original_size":4,"resolution":"high","series_type":"distance","device_clock":"gps"},\
    "distance":{"type":"distance","data":[0,1.5,3.25,7.125],"original_size":4,"resolution":"high","series_type":"distance"},\
    "latlng":{"type":"latlng","data":[[47.123456789,8.2],[47.2,8.3],[47.3,8.4]],"original_size":3,"resolution":"medium","series_type":"time"},\
    "altitude":{"type":"altitude","data":[401.2,402.4,403.6,404.8],"original_size":4,"resolution":"high","series_type":"distance"},\
    "watts":{"type":"watts","data":[210,0,305],"original_size":3,"resolution":"low","series_type":"time","sensor":{"name":"crank","paired":true}},\
    "heartrate":{"type":"heartrate","data":[120,131,142,150],"original_size":4,"resolution":"high","series_type":"distance"}}
    """

    /// Missing watts/heartrate/latlng keys, an empty altitude array and a time
    /// stream longer than distance.
    static let partialStreams = """
    {"time":{"data":[0,1,2,3,4],"original_size":5,"resolution":"high","series_type":"time"},\
    "distance":{"data":[0,2.5],"original_size":2,"resolution":"low","series_type":"time"},\
    "altitude":{"data":[],"original_size":0,"resolution":"high","series_type":"time"}}
    """

    static func rawBody(
        id: String = activityID, streams: String? = sixStreams,
        generation: String? = "g1", revision: String = "1", state: String = "current"
    ) -> Data {
        Data("""
        {"schemaVersion":"1","serverTime":"2026-09-22T12:00:01.000Z","data":{\
        "activity_id":"\(id)","metadata":\(metadataJSON(generation: generation, revision: revision, state: state)),\
        "requested_types":["time","distance","latlng","altitude","watts","heartrate"],\
        "streams":\(streams ?? "null"),"last_error":null,"next_retry_at":null}}
        """.utf8)
    }

    static func raw(
        id: String = activityID, streams: String? = sixStreams,
        generation: String? = "g1", revision: String = "1", state: String = "current"
    ) throws -> (dto: ActivityMapAPI.ActivityStreams, body: Data) {
        let body = rawBody(id: id, streams: streams, generation: generation, revision: revision, state: state)
        let dto = try ActivityMapAPI.makeDecoder().decode(
            ActivityMapAPI.Envelope<ActivityMapAPI.ActivityStreams>.self, from: body).data
        return (dto, body)
    }

    static let distanceSummary = """
    {"version":1,"basis":"distance","time":[0,1,3],"distance":[0,1.5,5.2],\
    "latlng":[[47.1,8.2],[47.2,8.3],[47.3,8.4]],"altitude":[401.2,402.4,404.2],"heartrate":[120,131,146]}
    """
    static let timeSummary = """
    {"version":1,"basis":"time","time":[0,60,120],"watts":[210,180,305]}
    """
    /// No usable axis: a valid, current set without a chart.
    static let noAxisSummary = #"{"version":1,"basis":null}"#

    static func summaryJSON(
        id: String = activityID, summary: String? = distanceSummary,
        generation: String? = "g1", revision: String = "1", state: String = "current"
    ) -> String {
        """
        {"activity_id":"\(id)","metadata":\(metadataJSON(generation: generation, revision: revision, state: state)),\
        "summary":\(summary ?? "null"),"last_error":null,"next_retry_at":null}
        """
    }

    static func summary(
        id: String = activityID, summary: String? = distanceSummary,
        generation: String? = "g1", revision: String = "1", state: String = "current"
    ) throws -> ActivityMapAPI.ActivityStreamSummary {
        try ActivityMapAPI.makeDecoder().decode(
            ActivityMapAPI.ActivityStreamSummary.self,
            from: Data(summaryJSON(id: id, summary: summary, generation: generation, revision: revision, state: state).utf8))
    }

    static func envelope(_ data: String) -> Data {
        Data((#"{"schemaVersion":"1","serverTime":"2026-09-22T12:00:01.000Z","data":"# + data + "}").utf8)
    }

    /// An activity carrying stream metadata, as sync delivers it.
    @MainActor static func activity(
        id: String = activityID, generation: String? = "g1", revision: String = "1", state: String = "current"
    ) throws -> ActivityMapAPI.Activity {
        let metadata = try JSONSerialization.jsonObject(
            with: Data(metadataJSON(generation: generation, revision: revision, state: state).utf8))
        return try Fixtures.activity(["id": id, "streams": metadata])
    }
}

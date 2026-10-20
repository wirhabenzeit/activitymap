#if DEBUG
import Foundation
import QuartzCore
import UIKit

/// Main-thread cost of one scripted gesture, for before/after comparisons in
/// the simulator. Enabled only by `--perf-probe`; the UI test resets and dumps
/// it through Darwin notifications and reads the JSON written to
/// `ACTIVITYMAP_PERF_PATH`.
enum PerfProbe {
    static let enabled = ProcessInfo.processInfo.arguments.contains("--perf-probe")
    private static var counts: [String: Int] = [:]
    private static var busy: CFTimeInterval = 0
    private static var longest: CFTimeInterval = 0
    private static var iterationStart: CFTimeInterval?
    private static var frames = 0
    private static var droppedFrames = 0
    private static var lastTimestamp: CFTimeInterval?
    private static var started: CFTimeInterval = CACurrentMediaTime()
    private static var link: CADisplayLink?
    private static var observer: CFRunLoopObserver?
    private static let ticker = Ticker()
    /// True between reset and dump; fixture probes pause their own sampling.
    private(set) static var measuring = false

    /// Counts one body evaluation of `name` while measuring.
    static func count(_ name: String) {
        guard enabled else { return }
        counts[name, default: 0] += 1
    }

    static func install() {
        guard enabled, observer == nil else { return }
        let observer = CFRunLoopObserverCreateWithHandler(nil,
            CFRunLoopActivity.afterWaiting.rawValue | CFRunLoopActivity.beforeWaiting.rawValue, true, 0) { _, activity in
            MainActor.assumeIsolated {
                let now = CACurrentMediaTime()
                if activity == .afterWaiting {
                    iterationStart = now
                } else if let start = iterationStart {
                    busy += now - start
                    longest = max(longest, now - start)
                    iterationStart = nil
                }
            }
        }
        CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
        self.observer = observer
        let link = CADisplayLink(target: ticker, selector: #selector(Ticker.tick(_:)))
        link.add(to: .main, forMode: .common)
        self.link = link
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        CFNotificationCenterAddObserver(center, nil, { _, _, _, _, _ in
            DispatchQueue.main.async { PerfProbe.reset() }
        }, "activitymap.perf.reset" as CFString, nil, .deliverImmediately)
        CFNotificationCenterAddObserver(center, nil, { _, _, _, _, _ in
            DispatchQueue.main.async { PerfProbe.dump() }
        }, "activitymap.perf.dump" as CFString, nil, .deliverImmediately)
    }

    fileprivate static func frame(_ link: CADisplayLink) {
        frames += 1
        let expected = link.targetTimestamp - link.timestamp
        if let lastTimestamp, expected > 0 {
            // Callbacks run on the main thread; a late one skipped vsyncs.
            droppedFrames += max(0, Int(((link.timestamp - lastTimestamp) / expected).rounded()) - 1)
        }
        lastTimestamp = link.timestamp
    }

    static func reset() {
        counts = [:]
        busy = 0; longest = 0; frames = 0; droppedFrames = 0
        lastTimestamp = nil
        started = CACurrentMediaTime()
        measuring = true
    }

    static func dump() {
        measuring = false
        guard let path = ProcessInfo.processInfo.environment["ACTIVITYMAP_PERF_PATH"] else { return }
        let report: [String: Any] = [
            "durationMs": (CACurrentMediaTime() - started) * 1000,
            "mainBusyMs": busy * 1000,
            "longestIterationMs": longest * 1000,
            "frames": frames,
            "droppedFrames": droppedFrames,
            "bodies": counts,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]) {
            try? data.write(to: URL(fileURLWithPath: path), options: .atomic)
        }
    }

    private final class Ticker: NSObject {
        @objc func tick(_ link: CADisplayLink) { PerfProbe.frame(link) }
    }
}
#endif

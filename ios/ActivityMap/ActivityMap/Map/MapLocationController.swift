import CoreLocation
import Observation

@MainActor
protocol ForegroundLocationProvider: AnyObject {
    var delegate: CLLocationManagerDelegate? { get set }
    var authorizationStatus: CLAuthorizationStatus { get }
    func requestWhenInUseAuthorization()
    func requestLocation()
    func stopUpdatingLocation()
}

extension CLLocationManager: ForegroundLocationProvider {}

/// A single foreground fix. No following, heading updates or background access.
@MainActor @Observable
final class MapLocationController: NSObject, CLLocationManagerDelegate {
    private(set) var isRequesting = false
    var errorMessage: String?
    private(set) var offersSettings = false
    @ObservationIgnored private let provider: any ForegroundLocationProvider
    @ObservationIgnored private var timeout: Task<Void, Never>?
    @ObservationIgnored private var completion: ((CLLocationCoordinate2D) -> Void)?
    @ObservationIgnored private var requestedAt: Date?
    @ObservationIgnored private var requestedFix = false
    @ObservationIgnored private let requestTimeout: Duration

    init(provider: any ForegroundLocationProvider = CLLocationManager(), requestTimeout: Duration = .seconds(15)) {
        self.provider = provider
        self.requestTimeout = requestTimeout
        super.init()
        provider.delegate = self
        (provider as? CLLocationManager)?.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func locate(_ completion: @escaping (CLLocationCoordinate2D) -> Void) {
        guard !isRequesting else { return }
        errorMessage = nil
        offersSettings = false
        self.completion = completion
        requestedAt = Date()
        isRequesting = true
        authorizationChanged()
    }

    func cancel() {
        timeout?.cancel()
        timeout = nil
        provider.stopUpdatingLocation()
        completion = nil
        requestedAt = nil
        requestedFix = false
        if isRequesting { isRequesting = false }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) { authorizationChanged() }

    func authorizationChanged() {
        guard isRequesting else { return }
        switch provider.authorizationStatus {
        case .notDetermined:
            provider.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            guard !requestedFix else { return }
            requestedFix = true
            // Start after the permission dialog, giving the user time to decide.
            requestedAt = Date()
            let requestTimeout = requestTimeout
            timeout = Task { [weak self] in
                do { try await Task.sleep(for: requestTimeout) } catch { return }
                self?.fail("Your current location could not be found. Try again outdoors with Location Services enabled.")
            }
            provider.requestLocation()
        case .denied:
            fail("Location access is off. Allow location access for ActivityMap in Settings, then tap Locate me again.", settings: true)
        case .restricted:
            fail("Location access is restricted on this device. Check Screen Time or your device administrator’s settings.")
        @unknown default:
            fail("Location access is unavailable on this device.")
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        receive(locations)
    }

    func receive(_ locations: [CLLocation], now: Date = Date()) {
        guard isRequesting, requestedFix, let requestedAt else { return }
        // Reject invalid or stale cached fixes; reduced-accuracy fixes remain usable.
        guard let location = locations.last(where: {
            $0.horizontalAccuracy >= 0 && $0.horizontalAccuracy.isFinite
                && $0.coordinate.latitude.isFinite && $0.coordinate.longitude.isFinite
                && CLLocationCoordinate2DIsValid($0.coordinate)
                && $0.timestamp >= requestedAt.addingTimeInterval(-30)
                && $0.timestamp <= now.addingTimeInterval(5)
        }) else { return }
        let callback = completion
        cancel()
        callback?(location.coordinate)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { receive(error) }

    func receive(_ error: Error) {
        guard isRequesting else { return }
        if let error = error as? CLError, error.code == .denied {
            fail("Location access is unavailable. Enable Location Services and allow ActivityMap access in Settings.", settings: true)
        } else {
            fail("Your current location could not be found. Try again outdoors with Location Services enabled.")
        }
    }

    private func fail(_ message: String, settings: Bool = false) {
        cancel()
        offersSettings = settings
        errorMessage = message
    }
}

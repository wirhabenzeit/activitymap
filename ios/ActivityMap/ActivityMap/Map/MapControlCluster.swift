import MapKit
import SwiftUI

struct MapControlCluster: View {
    private static let defaultRegion = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 46.95, longitude: 9.1),
        span: MKCoordinateSpan(latitudeDelta: 2.2, longitudeDelta: 2.2)
    )

    @Binding var cameraPosition: MapCameraPosition
    @Binding var isPitched: Bool

    var body: some View {
        VStack(spacing: 10) {
            group {
                controlButton("plus", action: zoomIn)
                controlButton("minus", action: zoomOut)
            }
            group {
                controlButton("arrow.up.and.down.and.arrow.left.and.right") {
                    isPitched.toggle()
                }
            }
            group {
                controlButton("location.fill", action: recenter)
            }
            group {
                controlButton("arrow.up.left.and.arrow.down.right", action: {})
            }
            group {
                controlButton("square.and.arrow.down", action: {})
                controlButton("square.and.arrow.up", action: {})
            }
        }
    }

    @ViewBuilder
    private func group(@ViewBuilder content: () -> some View) -> some View {
        VStack(spacing: 0) {
            content()
        }
        .background(.background, in: RoundedRectangle(cornerRadius: 10))
        .shadow(color: .black.opacity(0.2), radius: 4, y: 2)
    }

    private func controlButton(_ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .frame(width: 36, height: 36)
        }
        .buttonStyle(.plain)
    }

    private func zoomIn() {
        guard let region = cameraPosition.region else { return }
        withAnimation {
            cameraPosition = .region(
                MKCoordinateRegion(
                    center: region.center,
                    span: MKCoordinateSpan(
                        latitudeDelta: region.span.latitudeDelta * 0.5,
                        longitudeDelta: region.span.longitudeDelta * 0.5
                    )
                )
            )
        }
    }

    private func zoomOut() {
        guard let region = cameraPosition.region else { return }
        withAnimation {
            cameraPosition = .region(
                MKCoordinateRegion(
                    center: region.center,
                    span: MKCoordinateSpan(
                        latitudeDelta: region.span.latitudeDelta * 2,
                        longitudeDelta: region.span.longitudeDelta * 2
                    )
                )
            )
        }
    }

    private func recenter() {
        withAnimation {
            cameraPosition = .region(Self.defaultRegion)
        }
    }
}

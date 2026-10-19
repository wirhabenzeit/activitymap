import SwiftUI
import Testing
import Vision
@testable import ActivityMap

@MainActor
struct AppToolbarTests {
    @Test func windowAndTraitLayoutsShareTheCompactPolicy() {
        let phone = AppToolbarLayout(size: CGSize(width: 874, height: 402), verticalSizeClass: .compact, typeSize: .large)
        let tablet = AppToolbarLayout(size: CGSize(width: 1180, height: 820), verticalSizeClass: .regular, typeSize: .large)
        let standalone = AppToolbarLayout(verticalSizeClass: .compact, typeSize: .large)
        for layout in [phone, tablet, standalone] {
            #expect(layout.isCompact && layout.height == 44 && layout.titleLineLimit == 1)
        }
        #expect(phone.packsListControls && standalone.packsListControls)
        #expect(!tablet.packsListControls, "Tablet keeps its separate List controls despite its compact toolbar")
    }

    @Test func portraitAndAccessibilityTextRetainRoom() {
        let portrait = AppToolbarLayout(size: CGSize(width: 402, height: 874), verticalSizeClass: .regular, typeSize: .large)
        let splitWindow = AppToolbarLayout(size: CGSize(width: 650, height: 1000), verticalSizeClass: .regular, typeSize: .large)
        let accessibleLandscape = AppToolbarLayout(size: CGSize(width: 874, height: 402), verticalSizeClass: .compact, typeSize: .accessibility3)
        for layout in [portrait, splitWindow, accessibleLandscape] {
            #expect(!layout.isCompact && !layout.packsListControls)
            #expect(layout.height == 54 && layout.titleLineLimit == 2)
        }
    }

    @Test(arguments: [false, true])
    func titleRemainsCenteredWithOrWithoutTrailingActions(hasTrailingAction: Bool) throws {
        let layout = AppToolbarLayout(verticalSizeClass: .compact, typeSize: .large)
        let toolbar = AppToolbar(
            leading: AnyView(AppToolbarBackButton(label: "Back", identifier: "back", action: {})),
            principal: AnyView(Text("Training volume").font(.headline)),
            trailing: hasTrailingAction ? AnyView(Image(systemName: "line.3.horizontal").frame(width: 44, height: 44)) : AnyView(EmptyView()))
        let renderer = ImageRenderer(content: toolbar.bar
            .environment(\.appToolbarLayout, layout)
            .frame(width: 874, height: 44))
        renderer.scale = 2
        let pixels = try #require(renderer.cgImage)
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        try VNImageRequestHandler(cgImage: pixels).perform([request])
        let title = try #require(request.results?.first { $0.topCandidates(1).first?.string == "Training volume" })
        #expect(abs(title.boundingBox.midX - 0.5) < 0.02,
                "The visible title stays centered even when a toolbar side is empty")
    }
}

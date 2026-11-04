// swift-tools-version:5.9
// The Cutiva iOS engine (ADR 0004, ADR 0007): renders a `RenderPlan` with AVFoundation and
// analyses videos for auto-reframe. No dependencies; MediaPipe is used only where the app links
// it (`MediaPipeFaceDetector.swift` compiles when `MediaPipeTasksVision` can be imported).
import PackageDescription

let package = Package(
    name: "CutivaEngine",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "CutivaEngine", targets: ["CutivaEngine"])],
    targets: [
        .target(name: "CutivaEngine", path: "Sources/CutivaEngine"),
        .testTarget(
            name: "CutivaEngineTests",
            dependencies: ["CutivaEngine"],
            path: "Tests/CutivaEngineTests",
            resources: [.copy("Fixtures")]
        ),
    ]
)

import ExpoModulesCore
import Foundation

/**
 * The native side of `@cutiva/expo` on iOS (ADR 0007): analysis for auto-reframe and export of a
 * render plan, on the Cutiva iOS engine (compiled into this pod from `Engine/`). Planning happens in
 * JavaScript with `@cutiva/core`; this only measures and draws. Errors reject with the engine's
 * stable codes (`MODEL_LOAD_FAILED`, `NO_VIDEO_TRACK`, `ANALYSIS_CANCELLED`, `EXPORT_FAILED`, ...),
 * the same as on Android.
 */
public class CutivaModule: Module {
    private let jobs = Jobs()

    public func definition() -> ModuleDefinition {
        Name("Cutiva")
        Events("onProgress")

        /** Measures a video for auto-reframe; resolves with the measurements as JSON text. */
        AsyncFunction("analyze") { (uri: String, options: [String: Any], job: String) async throws -> String in
            try await self.run(job) {
                let url = try Self.fileURL(uri)
                let model = try await FaceModel.load(onProgress: { self.progress(job, $0, "model") })
                let detector = try MediaPipeFaceDetector(model: model)
                let opts = AnalyzeOptions(
                    fps: (options["fps"] as? NSNumber)?.intValue ?? 5,
                    width: (options["width"] as? NSNumber)?.intValue ?? 640,
                    fromUs: (options["fromUs"] as? NSNumber)?.int64Value ?? 0,
                    toUs: (options["toUs"] as? NSNumber)?.int64Value ?? -1
                )
                let m = try await ReframeAnalyzer().analyze(url, detector: detector, options: opts) { ratio, stage in
                    self.progress(job, ratio, stage)
                }
                return m.toJson()
            }
        }

        /** Exports a render plan (JSON from `renderPlan`) to an MP4; resolves with its file URI and size. */
        AsyncFunction("export") { (planJson: String, outputPath: String?, job: String) async throws -> [String: Any] in
            try await self.run(job) {
                let plan = try RenderPlan.fromJson(planJson)
                let out: URL
                if let path = outputPath, !path.isEmpty {
                    out = try Self.fileURL(path)
                } else {
                    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                    out = caches.appendingPathComponent("cutiva-\(Int64(Date().timeIntervalSince1970 * 1000)).mp4")
                }
                let summary = try await CutivaExporter().export(plan, to: out) { self.progress(job, $0, "export") }
                return ["uri": out.absoluteString, "durationMs": summary.durationMs, "fileSizeBytes": summary.fileSizeBytes]
            }
        }

        /** Stops a running analysis or export; its promise rejects with `ANALYSIS_CANCELLED` or `EXPORT_CANCELLED`. */
        Function("cancel") { (job: String) in
            self.jobs.cancel(job)
        }
    }

    private func progress(_ job: String, _ ratio: Double, _ stage: String) {
        sendEvent("onProgress", ["job": job, "ratio": ratio, "stage": stage])
    }

    /** Runs `body` as a cancellable task registered under `job`, with engine errors turned into coded JS errors. */
    private func run<T: Sendable>(_ job: String, _ body: @escaping @Sendable () async throws -> T) async throws -> T {
        let task = Task { try await body() }
        jobs.add(job) { task.cancel() }
        defer { jobs.remove(job) }
        do {
            return try await task.value
        } catch let e as CutivaError {
            throw Exception(name: "CutivaError", description: e.message, code: e.code)
        } catch let e as Exception {
            throw e
        } catch {
            throw Exception(name: "CutivaError", description: error.localizedDescription, code: "UNKNOWN")
        }
    }

    /** A `file://` URI or a plain path. Photo library (`ph://`) URIs aren't files: pick with a file copy instead. */
    static func fileURL(_ uri: String) throws -> URL {
        if uri.hasPrefix("file://"), let url = URL(string: uri) { return url }
        if uri.hasPrefix("/") { return URL(fileURLWithPath: uri) }
        throw CutivaError("ASSET_NOT_FOUND", "Can't read \(uri): pass a file:// URI (copy Photos assets to a file first).")
    }
}

/** Running jobs by id, with the closure that cancels each. */
private final class Jobs: @unchecked Sendable {
    private let lock = NSLock()
    private var cancels: [String: () -> Void] = [:]

    func add(_ job: String, cancel: @escaping () -> Void) {
        lock.lock()
        cancels[job] = cancel
        lock.unlock()
    }

    func remove(_ job: String) {
        lock.lock()
        cancels[job] = nil
        lock.unlock()
    }

    func cancel(_ job: String) {
        lock.lock()
        let c = cancels[job]
        lock.unlock()
        c?()
    }
}

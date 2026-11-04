import CryptoKit
import Foundation

/**
 * The face model: MediaPipe's `face_landmarker.task` (float16, version 1, 3,758,596 bytes,
 * Apache-2.0), the same file and hash as `@cutiva/web/mediapipe` and the Android engine. Downloaded
 * on first use, checked against its pinned SHA-256 and kept in Application Support; checked again
 * on every load.
 */
public enum FaceModel {
    public static let defaultURL = URL(string: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task")!
    public static let SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"

    static func sha256(_ data: Data) -> String { CryptoKit.SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

    /** Where verified models are kept: Application Support/cutiva-models. */
    public static func defaultDirectory() throws -> URL {
        try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("cutiva-models", isDirectory: true)
    }

    /**
     * A local file holding the model: the copy in `directory` (default Application Support/cutiva-models)
     * when it still has `sha256`, else downloaded from `url` and checked. Throws `CutivaError` with
     * `MODEL_LOAD_FAILED` when the download fails or the hash doesn't match.
     */
    public static func load(
        url: URL = defaultURL, sha256 expectedHash: String = SHA256, directory: URL? = nil, onProgress: ((Double) -> Void)? = nil
    ) async throws -> URL {
        let expected = expectedHash.lowercased()
        let dir: URL
        do {
            dir = try directory ?? defaultDirectory()
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        } catch {
            throw CutivaError("MODEL_LOAD_FAILED", "Couldn't create the model folder: \(error.localizedDescription)")
        }
        let file = dir.appendingPathComponent("\(expected).task")
        if let bytes = try? Data(contentsOf: file) {
            if sha256(bytes) == expected { return file }
            try? FileManager.default.removeItem(at: file)
        }
        let bytes: Data
        do {
            bytes = try await download(url, onProgress)
        } catch {
            throw CutivaError("MODEL_LOAD_FAILED", "Couldn't download the face model from \(url): \(error.localizedDescription)")
        }
        let got = sha256(bytes)
        guard got == expected else {
            throw CutivaError("MODEL_LOAD_FAILED", "The face model from \(url) has SHA-256 \(got), expected \(expected).")
        }
        do {
            let tmp = dir.appendingPathComponent("\(expected).part")
            try bytes.write(to: tmp, options: .atomic)
            try? FileManager.default.removeItem(at: file)
            try FileManager.default.moveItem(at: tmp, to: file)
        } catch {
            throw CutivaError("MODEL_LOAD_FAILED", "Couldn't save the face model: \(error.localizedDescription)")
        }
        return file
    }

    private static func download(_ url: URL, _ onProgress: ((Double) -> Void)?) async throws -> Data {
        if url.isFileURL {
            let data = try Data(contentsOf: url)
            onProgress?(1)
            return data
        }
        let (bytes, response) = try await URLSession.shared.bytes(from: url)
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            throw CutivaError("MODEL_LOAD_FAILED", "HTTP \(http.statusCode)")
        }
        let total = response.expectedContentLength
        var data = Data()
        if total > 0 { data.reserveCapacity(Int(total)) }
        var chunk = [UInt8]()
        chunk.reserveCapacity(1 << 16)
        for try await byte in bytes {
            chunk.append(byte)
            if chunk.count == 1 << 16 {
                data.append(contentsOf: chunk)
                chunk.removeAll(keepingCapacity: true)
                if total > 0 { onProgress?(Double(data.count) / Double(total)) }
            }
        }
        data.append(contentsOf: chunk)
        onProgress?(1)
        return data
    }
}

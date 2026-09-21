// Everything in this package is simulator-only: a device build of it is empty.
#if targetEnvironment(simulator)
import Network
import Observation
import UIKit

/// The default port the `hypersimcam` CLI listens on.
public let simCameraDefaultPort: UInt16 = 47865

/// The newest frame from the Mac's camera, and whether there is a Mac to hear from.
///
/// `SimCameraPicker` is built on this; use it directly to put the frames in a camera UI of
/// your own. Call `start()` when the viewfinder appears and `stop()` when it goes: the Mac
/// keeps its camera open only while something is connected.
///
/// A raw TCP connection rather than URLSession, so plain loopback needs no App Transport
/// Security exception in the app's Info.plist.
@MainActor @Observable
public final class SimCameraFeed {
    /// The latest frame, landscape as the Mac's camera gives it, decoded and ready to draw.
    /// `nil` until the first one arrives and after `stop()`.
    public private(set) var frame: UIImage?
    /// True when nothing is listening on the port, or the stream ended. `start()` retries.
    public private(set) var unavailable = false
    /// The loopback port the CLI is expected on.
    public let port: UInt16

    @ObservationIgnored private var connection: NWConnection?

    public init(port: UInt16 = simCameraDefaultPort) {
        self.port = port
    }

    /// Connects (or reconnects) to the CLI. Safe to call again after a failure.
    public func start() {
        stop()
        unavailable = false
        guard let port = NWEndpoint.Port(rawValue: port) else {
            unavailable = true
            return
        }
        let connection = NWConnection(host: "127.0.0.1", port: port, using: .tcp)
        self.connection = connection
        // `.waiting` is what a refused connection looks like: nothing is listening yet.
        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .failed, .waiting: Task { @MainActor in self?.lost(connection) }
            default: break
            }
        }
        Self.read(connection,
                  deliver: { [weak self] image in Task { @MainActor in self?.show(image, from: connection) } },
                  ended: { [weak self] in Task { @MainActor in self?.lost(connection) } })
        connection.start(queue: .global(qos: .userInteractive))
    }

    /// Disconnects, which lets the Mac release its camera, and clears `frame`.
    public func stop() {
        connection?.cancel()
        connection = nil
        frame = nil
    }

    /// The current frame as a photo: the largest `aspect` (width over height) rectangle from
    /// the middle of the frame, unmirrored, upright, at the camera's own pixels.
    public func photo(aspect: CGFloat = 3.0 / 4.0) -> UIImage? {
        guard let cg = frame?.cgImage, aspect > 0 else { return nil }
        let full = CGSize(width: cg.width, height: cg.height)
        var size = full
        if full.width / full.height > aspect {
            size.width = min(full.width, (full.height * aspect).rounded(.down))
        } else {
            size.height = min(full.height, (full.width / aspect).rounded(.down))
        }
        let crop = CGRect(x: ((full.width - size.width) / 2).rounded(.down),
                          y: ((full.height - size.height) / 2).rounded(.down),
                          width: size.width, height: size.height)
        return cg.cropping(to: crop).map { UIImage(cgImage: $0, scale: 1, orientation: .up) }
    }

    private func show(_ image: UIImage, from source: NWConnection) {
        guard source === connection else { return }
        frame = image
    }

    private func lost(_ source: NWConnection) {
        guard source === connection else { return }
        stop()
        unavailable = true
    }

    /// One packet, then the next: a 4-byte big-endian length and that many bytes of JPEG.
    /// Decoded here, off the main actor, so the view only ever swaps a ready image in.
    nonisolated private static func read(_ connection: NWConnection,
                                         deliver: @escaping @Sendable (UIImage) -> Void,
                                         ended: @escaping @Sendable () -> Void) {
        connection.receive(minimumIncompleteLength: 4, maximumLength: 4) { head, _, _, error in
            guard let head, head.count == 4, error == nil else { return ended() }
            let length = head.reduce(0) { $0 << 8 | Int($1) }
            guard length > 0, length < 8_000_000 else { return ended() }
            connection.receive(minimumIncompleteLength: length, maximumLength: length) { body, _, _, error in
                guard let body, body.count == length, error == nil else { return ended() }
                if let image = UIImage(data: body)?.preparingForDisplay() { deliver(image) }
                read(connection, deliver: deliver, ended: ended)
            }
        }
    }
}
#endif

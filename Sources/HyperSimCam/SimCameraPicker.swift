#if targetEnvironment(simulator)
import SwiftUI

/// A take-a-photo screen for the simulator, fed by the Mac's camera through the
/// `hypersimcam` CLI. Present it where a device build presents its real camera:
///
///     #if targetEnvironment(simulator) && DEBUG
///     SimCameraPicker(image: $image)
///     #else
///     DeviceCamera(image: $image)
///     #endif
///
/// The shutter sets `image` and dismisses; Cancel dismisses and leaves `image` alone.
public struct SimCameraPicker: View {
    @Binding private var image: UIImage?
    @Environment(\.dismiss) private var dismiss
    @State private var feed: SimCameraFeed
    private let aspect: CGFloat
    private let mirrored: Bool

    /// - Parameters:
    ///   - image: Receives the photo when the shutter is pressed.
    ///   - port: The loopback port the CLI listens on (`hypersimcam --port`).
    ///   - aspect: Width over height of the viewfinder and of the photo. 3:4 upright by
    ///     default, like a phone's front camera, cut from the middle of the Mac's frame.
    ///   - mirrored: Mirror the preview the way a selfie preview is. The photo never is.
    public init(image: Binding<UIImage?>,
                port: UInt16 = simCameraDefaultPort,
                aspect: CGFloat = 3.0 / 4.0,
                mirrored: Bool = true) {
        _image = image
        _feed = State(initialValue: SimCameraFeed(port: port))
        self.aspect = aspect
        self.mirrored = mirrored
    }

    public var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 20) {
                Text("MAC CAMERA · SIMULATOR ONLY")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.6))
                    .padding(.top, 16)
                viewfinder
                controls.padding(.bottom, 24)
            }
        }
        .task { feed.start() }
        .onDisappear { feed.stop() }
    }

    private var viewfinder: some View {
        Color.black
            .aspectRatio(aspect, contentMode: .fit)
            .overlay {
                if let frame = feed.frame {
                    Image(uiImage: frame).resizable().scaledToFill().scaleEffect(x: mirrored ? -1 : 1)
                        .accessibilityLabel("Camera preview")
                } else if feed.unavailable {
                    noFeed
                } else {
                    ProgressView().tint(.white)
                }
            }
            .clipped()
            .frame(maxHeight: .infinity)
    }

    private var noFeed: some View {
        VStack(spacing: 10) {
            Text("No camera feed").font(.system(size: 17, weight: .bold)).foregroundStyle(.white)
            Text("On this Mac, run").font(.system(size: 14)).foregroundStyle(.white.opacity(0.7))
            Text(command)
                .font(.system(size: 13, weight: .bold, design: .monospaced))
                .foregroundStyle(.yellow)
                // One line, shrunk to fit: a command that wraps mid-flag reads as two.
                .lineLimit(1).minimumScaleFactor(0.5)
                .textSelection(.enabled)
            Button("Try again") { feed.start() }
                .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                .frame(minWidth: 44, minHeight: 44)
        }
        .multilineTextAlignment(.center).padding(24)
    }

    private var command: String {
        let base = "npx github:hypersocialinc/hypersimcam"
        return feed.port == simCameraDefaultPort ? base : "\(base) --port \(feed.port)"
    }

    private var controls: some View {
        ZStack {
            Button {
                guard let shot = feed.photo(aspect: aspect) else { return }
                image = shot
                dismiss()
            } label: {
                Circle().fill(.white).frame(width: 68, height: 68)
                    .overlay(Circle().strokeBorder(.black, lineWidth: 2).padding(4))
            }
            .disabled(feed.frame == nil)
            .opacity(feed.frame == nil ? 0.35 : 1)
            .accessibilityLabel("Take photo")
            HStack {
                Button("Cancel") { dismiss() }
                    .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                    .frame(minWidth: 44, minHeight: 44)
                Spacer()
            }
            .padding(.horizontal, 24)
        }
    }
}
#endif

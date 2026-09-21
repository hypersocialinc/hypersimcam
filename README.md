# hypersimcam

A live camera feed for the iOS Simulator, from your Mac's camera.

Two halves:

- a small CLI on the Mac that reads the camera with ffmpeg and serves frames on `127.0.0.1`
- a Swift package, `HyperSimCam`, that gives your app a take-a-photo screen (or just the
  frames) when it runs in the simulator

## Why

The simulator has no usable camera. On the setup this was built on (Xcode 26.2, iOS 26.2
simulator, one Mac) the simulator's camera is a grey stub that does not look at the host's
cameras at all, so virtual-camera tools on the Mac never reach it. We have not tested other
Xcode versions.

The simulator does share the Mac's network, though. So this goes around the camera stack
instead of through it: the Mac streams JPEG frames over loopback, and a debug build of your
app shows those where it would otherwise open the camera. That is enough to walk a
"take a selfie" flow end to end, with a real face, without reaching for a device.

## Requirements

- macOS with [ffmpeg](https://ffmpeg.org) on the `PATH` (`brew install ffmpeg`)
- Node 18 or newer (no npm dependencies)
- An app targeting iOS 17+, built with Xcode 16 or newer (the package is Swift 6)

## Quick start

### 1. On the Mac

```sh
npx github:hypersocialinc/hypersimcam
```

or clone this repo and run `node bin/hypersimcam.js`. (It is not on npm.)

```
hypersimcam                  stream the first camera
hypersimcam --camera <index> stream another one (see --list)
hypersimcam --list           list the cameras and their indexes
hypersimcam --port <port>    listen somewhere other than 47865
```

The indexes are ffmpeg's and can change when a camera is plugged in or an iPhone comes into
range, so check `--list` again if the wrong camera opens.

The first run makes macOS ask for camera permission **for your terminal app** (Terminal,
iTerm, your editor's terminal), because that is the process ffmpeg runs under. Allow it, then
run the command again.

The camera is opened only while an app is connected, and released when the last one
disconnects, so the green light is on only while a viewfinder is open.

### 2. In the app

Add the package in Xcode (File → Add Package Dependencies…) or in `Package.swift`:

```swift
.package(url: "https://github.com/hypersocialinc/hypersimcam.git", from: "0.1.0")
```

Then, wherever you present your camera:

```swift
#if targetEnvironment(simulator) && DEBUG
SimCameraPicker(image: $image)
#else
YourRealCamera(image: $image)   // UIImagePickerController, AVCaptureSession, …
#endif
```

with `import HyperSimCam` at the top of the file. `SimCameraPicker` sets `image` when the
shutter is pressed and dismisses itself; Cancel dismisses and leaves `image` alone. If the
CLI is not running it says so, shows the command, and offers "Try again".

Everything in the package is wrapped in `#if targetEnvironment(simulator)`, so a device build
links an empty module. The `&& DEBUG` in your own code keeps it out of simulator Release
builds too.

Options:

```swift
SimCameraPicker(image: $image,
                port: 47865,       // match `hypersimcam --port`
                aspect: 3.0 / 4.0, // width / height of the viewfinder and the photo
                mirrored: true)    // mirror the preview like a selfie camera; the photo never is
```

### Your own camera UI

`SimCameraFeed` is the frames without the screen:

```swift
@State private var feed = SimCameraFeed()      // @MainActor, @Observable

feed.start()                 // connect; call again to retry
feed.frame                   // UIImage?, the newest frame, landscape as the Mac gives it
feed.unavailable             // true when nothing is listening, or the stream ended
feed.photo(aspect: 3.0 / 4.0) // centre crop of the current frame, unmirrored
feed.stop()                  // disconnect, which lets the Mac release its camera
```

## Limits

- It **replaces the take-a-photo screen**; it does not make the simulator's camera work.
  `AVCaptureSession`, `UIImagePickerController(sourceType: .camera)`, and anything else that
  talks to AVFoundation behave exactly as before.
- It does not test your real camera UI, the camera permission prompt, or
  `NSCameraUsageDescription`. Those still need a device.
- Stills only. There is no video recording, audio, flash, zoom, or camera switching.
- The picture is a Mac webcam's: landscape 1080p (720p where the camera lacks it), with an
  upright photo cropped from the middle. A 3:4 photo from a 1080p frame is 810×1080.
- Loopback only, by design. It will not feed a physical device or another machine.

## How it works

`ffmpeg -f avfoundation` → MJPEG on a pipe → the CLI cuts the stream into whole JPEGs and
sends each as a 4-byte big-endian length followed by the JPEG, over TCP on `127.0.0.1:47865`.
A client that has fallen behind is skipped rather than queued, so the viewfinder shows the
newest frame. The app side reads with `NWConnection` (raw TCP, so no App Transport Security
exception is needed) and decodes off the main actor.

## Development

```sh
npm test    # node --test: the JPEG stream splitter
xcodebuild build -scheme HyperSimCam -destination 'generic/platform=iOS Simulator'
```

## License

MIT © 2026 HyperSocial Incorporated

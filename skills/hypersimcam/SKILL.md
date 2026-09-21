---
name: hypersimcam
description: Give the iOS Simulator a live camera feed from the Mac's camera. Use when an iOS app's camera, selfie, photo-capture or scan flow has to be built, run or tested in the simulator, when the simulator camera shows a grey or black screen, or when the user asks for a simulator camera or mentions hypersimcam or HyperSimCam.
---

# hypersimcam

The iOS Simulator has no usable camera (on Xcode 26.2 / iOS 26.2 it is a grey stub that
ignores the Mac's cameras, so virtual-camera apps do not reach it). hypersimcam goes around
it: a CLI on the Mac streams the camera over loopback, and the `HyperSimCam` Swift package
shows those frames in the app, in simulator builds only.

Repo and full README: https://github.com/hypersocialinc/hypersimcam

It has two halves, and **the app half is per app**. Running the CLI does nothing for an app
that has not adopted the package.

## 1. Adopt it in the app (once per app)

Requires iOS 17+, Xcode 16+. Add the package:

```swift
.package(url: "https://github.com/hypersocialinc/hypersimcam.git", from: "0.1.0")
```

(In an `.xcodeproj`: File → Add Package Dependencies…, or add the
`XCRemoteSwiftPackageReference` and product dependency `HyperSimCam` to the app target.)

Find where the app presents its camera (`UIImagePickerController` with `.camera`, an
`AVCaptureSession` view, etc.) and switch on the environment there:

```swift
import HyperSimCam

#if targetEnvironment(simulator) && DEBUG
SimCameraPicker(image: $image)
#else
TheAppsRealCamera(image: $image)
#endif
```

`SimCameraPicker(image:port:aspect:mirrored:)` sets the `UIImage?` binding on shutter and
dismisses itself. Defaults: port 47865, aspect 3:4 upright, preview mirrored (the photo never
is). The whole package is inside `#if targetEnvironment(simulator)`, so device builds link
an empty module; do not reference its types outside that `#if`.

If the app has its own camera UI to keep, use the frames instead of the screen:

```swift
@State private var feed = SimCameraFeed()   // @MainActor @Observable
feed.start()                  // connect, or retry
feed.frame                    // UIImage?, newest frame, landscape
feed.unavailable              // true when the CLI is not running
feed.photo(aspect: 3.0 / 4.0) // centre crop, unmirrored
feed.stop()                   // disconnect; the Mac releases its camera
```

## 2. Run the Mac side (each session)

Needs ffmpeg (`brew install ffmpeg`) and Node 18+. Run it in the background; it is a
long-running server:

```sh
npx --yes github:hypersocialinc/hypersimcam              # first camera, 127.0.0.1:47865
npx --yes github:hypersocialinc/hypersimcam --list       # camera indexes
npx --yes github:hypersocialinc/hypersimcam --camera 1 --port 47866
```

- `could not listen on 47865 … EADDRINUSE` means another instance is already serving. Reuse
  it, or pick another `--port` and pass the same `port:` to `SimCameraPicker` / `SimCameraFeed`.
  Do not kill a process you did not start.
- Camera indexes are ffmpeg's and move when cameras come and go. Re-check `--list`.
- The first run triggers a macOS camera-permission prompt for the *terminal app*. Only the
  user can accept it. If no frames ever arrive, ask them to check System Settings → Privacy &
  Security → Camera.
- The camera (and its green light) is on only while an app is connected. Stop the CLI and
  close the app's camera screen when you are done.

## Verifying without keeping pictures of the user

Frames are live images of the user and their room. Do not save, commit, upload or attach
them, and prefer not to screenshot the simulator while the viewfinder is live. Verify with
text instead:

- the CLI prints `viewfinder open — camera on` when the app connects, and
  `viewfinder closed — camera off` when it leaves;
- in the app, log or display sizes, not pixels: `feed.frame?.size` should be 1920×1080 (or
  1280×720), and a 3:4 `photo()` 810×1080;
- the "No camera feed" state (CLI not running) contains no camera image and is safe to
  screenshot.

## Limits — say these rather than overclaim

- It replaces the take-a-photo screen. It does **not** make `AVCaptureSession`,
  `UIImagePickerController(.camera)` or any AVFoundation capture work in the simulator.
- It does not exercise the real camera UI, the iOS camera permission prompt, or
  `NSCameraUsageDescription`. Those still need a device.
- Stills only: no video, audio, flash, zoom or camera switching. Mac webcam quality.
- Loopback only: it cannot feed a physical device.

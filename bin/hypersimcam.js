#!/usr/bin/env node
/**
 * The Mac's camera, for the iOS Simulator. The simulator's own camera shows nothing useful,
 * but it shares this machine's network, so an app running in it can read frames from here
 * instead. The HyperSimCam Swift package is the other end.
 *
 * Loopback only. The camera is opened when a viewfinder connects and released when the last
 * one leaves, so the green light is on only while someone is looking.
 *
 *   hypersimcam                  # the first camera
 *   hypersimcam --camera 1       # another one, by ffmpeg's avfoundation index
 *   hypersimcam --list           # what the indexes are
 *   hypersimcam --port 47865     # where to listen (match the app's `port:`)
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { packet, splitJpegs } from "../lib/frames.js";

const DEFAULT_PORT = 47865;
const NO_FFMPEG = "ffmpeg not found. Install it first: brew install ffmpeg";
const USAGE = `hypersimcam — the Mac's camera, for the iOS Simulator

  hypersimcam                  stream the first camera
  hypersimcam --camera <index> stream another one (see --list)
  hypersimcam --list           list the cameras and their indexes
  hypersimcam --port <port>    listen somewhere other than ${DEFAULT_PORT}
  hypersimcam --help           this`;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (process.platform !== "darwin") fail("hypersimcam needs macOS: it reads the camera through ffmpeg's avfoundation input.");

if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
} else if (args.includes("--list")) {
  list();
} else {
  const camera = flag("--camera") ?? "0";
  if (!/^\d+$/.test(camera)) fail(`--camera takes an index from --list, not "${camera}"`);
  const port = Number(flag("--port") ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`--port takes a number from 1 to 65535, not "${flag("--port")}"`);
  serve(camera, port);
}

function list() {
  const child = spawn("ffmpeg", ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""]);
  let video = false;
  let tail = "";
  child.stderr.on("data", (d) => {
    const lines = (tail + d.toString()).split("\n");
    tail = lines.pop() ?? "";
    for (const line of lines) {
      if (/AVFoundation video devices/.test(line)) video = true;
      else if (/AVFoundation audio devices/.test(line)) video = false;
      const device = line.match(/\] (\[\d+\] .+)$/);
      if (video && device && !/Capture screen/.test(device[1])) console.log(device[1]);
    }
  });
  child.on("error", () => fail(NO_FFMPEG));
}

function serve(camera, port) {
  const clients = new Set();
  let ffmpeg;

  // 1080p where the camera has it, because an upright photo is cropped out of the middle of
  // a landscape frame; 720p is what every Mac camera offers.
  function start(sizes = ["1920x1080", "1280x720"]) {
    const [size, ...smaller] = sizes;
    let pending = Buffer.alloc(0);
    let produced = false;
    const child = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      // No input buffering, and (below) every packet flushed as it is written: a viewfinder
      // that runs a second behind is not a viewfinder.
      "-fflags", "nobuffer", "-f", "avfoundation", "-framerate", "30", "-video_size", size, "-i", `${camera}:none`,
      // avfoundation reports a 1000k fps stream; without passthrough ffmpeg pads it out to
      // that rate with copies of one frame, hundreds a second, on every core it can find.
      "-fps_mode", "passthrough", "-f", "mjpeg", "-q:v", "3", "-flush_packets", "1", "pipe:1",
    ]);
    ffmpeg = child;
    child.stdout.on("data", (chunk) => {
      const split = splitJpegs(pending, chunk);
      pending = split.rest;
      const latest = split.frames.at(-1);
      if (!latest) return;
      produced = true;
      const bytes = packet(latest);
      // A viewfinder wants the newest frame, not every frame: skip a client that is behind.
      for (const c of clients) if (c.writableLength < bytes.length) c.write(bytes);
    });
    // A size the camera lacks is an error worth printing only once nothing smaller is left.
    child.stderr.on("data", (d) => { if (produced || !smaller.length) console.error(d.toString().trimEnd()); });
    child.on("error", () => console.error(NO_FFMPEG));
    child.on("exit", () => {
      if (ffmpeg !== child) return;
      ffmpeg = undefined;
      if (!produced && smaller.length && clients.size) return start(smaller);
      // The camera went away under a viewfinder that is still open (denied, unplugged).
      for (const c of clients) c.destroy();
    });
  }

  // ffmpeg's avfoundation input does not reliably leave on a polite signal, and a camera
  // left open is a green light left on: ask, then insist.
  function release(child) {
    child.kill("SIGTERM");
    setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 800).unref();
  }

  const server = createServer((socket) => {
    socket.setNoDelay(true);
    clients.add(socket);
    if (clients.size === 1) console.log("viewfinder open — camera on");
    if (!ffmpeg) start();
    const leave = () => {
      if (!clients.delete(socket)) return;
      if (clients.size === 0 && ffmpeg) {
        const child = ffmpeg;
        ffmpeg = undefined;
        release(child);
        console.log("viewfinder closed — camera off");
      }
    };
    socket.on("close", leave);
    socket.on("error", leave);
  });
  server.on("error", (err) => fail(`could not listen on ${port}: ${err.message}`));
  server.listen(port, "127.0.0.1", () => {
    console.log(`camera ${camera} ready for the simulator on 127.0.0.1:${port}`);
    console.log("open the camera screen in your app on a simulator; ctrl-c to stop");
  });
  const quit = () => {
    ffmpeg?.kill("SIGKILL");
    process.exit(0);
  };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
}

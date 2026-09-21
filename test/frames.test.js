import assert from "node:assert/strict";
import { test } from "node:test";
import { packet, splitJpegs } from "../lib/frames.js";

const jpeg = (...body) => Buffer.from([0xff, 0xd8, ...body, 0xff, 0xd9]);
const none = Buffer.alloc(0);

test("cuts back-to-back frames out of one chunk", () => {
  const a = jpeg(1, 2, 3);
  const b = jpeg(4, 5);
  const { frames, rest } = splitJpegs(none, Buffer.concat([a, b]));
  assert.deepEqual(frames, [a, b]);
  assert.equal(rest.length, 0);
});

test("keeps an unfinished frame for the next chunk", () => {
  const a = jpeg(1, 2, 3, 4);
  const first = splitJpegs(none, a.subarray(0, 3));
  assert.deepEqual(first.frames, []);
  const second = splitJpegs(first.rest, a.subarray(3));
  assert.deepEqual(second.frames, [a]);
  assert.equal(second.rest.length, 0);
});

test("a marker split across two chunks still ends the frame", () => {
  const a = jpeg(9, 9);
  const first = splitJpegs(none, a.subarray(0, a.length - 1));
  assert.deepEqual(first.frames, []);
  assert.deepEqual(splitJpegs(first.rest, a.subarray(a.length - 1)).frames, [a]);
});

test("a start marker split across two chunks still begins the frame", () => {
  const a = jpeg(7);
  const first = splitJpegs(none, Buffer.from([0x00, 0xff]));
  assert.deepEqual(splitJpegs(first.rest, a.subarray(1)).frames, [a]);
});

test("drops noise before the first frame", () => {
  const a = jpeg(1);
  assert.deepEqual(splitJpegs(none, Buffer.concat([Buffer.from([0, 1, 2]), a])).frames, [a]);
});

test("a packet is the length, big-endian, then the jpeg", () => {
  const a = jpeg(1, 2, 3);
  const p = packet(a);
  assert.equal(p.readUInt32BE(0), a.length);
  assert.deepEqual(p.subarray(4), a);
});

/**
 * ffmpeg writes MJPEG to a pipe as JPEGs back to back, in chunks that stop wherever the pipe
 * felt like it. This cuts whole JPEGs out of that stream and keeps the unfinished tail.
 *
 * A JPEG runs from SOI (FF D8) to EOI (FF D9). Inside the compressed data every FF is
 * followed by 00, so FF D9 can only be the end. (An embedded EXIF thumbnail would break that;
 * ffmpeg's mjpeg encoder writes none.)
 */
const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);

/**
 * @param {Buffer} pending the tail the last call could not finish
 * @param {Buffer} chunk what the pipe just delivered
 * @returns {{ frames: Buffer[], rest: Buffer }}
 */
export function splitJpegs(pending, chunk) {
  let data = pending.length ? Buffer.concat([pending, chunk]) : chunk;
  const frames = [];
  for (;;) {
    const start = data.indexOf(SOI);
    if (start < 0) {
      // No frame has begun. Keep a trailing FF: its D8 may be the next chunk's first byte.
      const keep = data.length && data[data.length - 1] === 0xff ? data.subarray(-1) : Buffer.alloc(0);
      return { frames, rest: keep };
    }
    const end = data.indexOf(EOI, start + 2);
    if (end < 0) return { frames, rest: data.subarray(start) };
    frames.push(data.subarray(start, end + 2));
    data = data.subarray(end + 2);
  }
}

/**
 * One frame on the wire: a 4-byte big-endian length, then the JPEG.
 * @param {Buffer} jpeg
 * @returns {Buffer}
 */
export function packet(jpeg) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(jpeg.length);
  return Buffer.concat([head, jpeg]);
}

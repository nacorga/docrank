/**
 * Output that survives `process.exit`. A write to a pipe is asynchronous on
 * macOS, so `process.stdout.write(text); process.exit()` drops what did not fit
 * the first pipe buffer (about 8 KB there): the reader gets truncated JSON.
 * `writeAll` writes synchronously and in full, retrying while the pipe is full.
 */
import { writeSync } from "node:fs";

const wait = new Int32Array(new SharedArrayBuffer(4));

/** Writes all of `text` to file descriptor `fd` (1 stdout, 2 stderr) before returning. */
export function writeAll(fd, text) {
  const buf = Buffer.from(text, "utf8");
  let offset = 0;
  while (offset < buf.length) {
    try {
      offset += writeSync(fd, buf, offset);
    } catch (e) {
      if (e.code === "EAGAIN") Atomics.wait(wait, 0, 0, 1); // the reader has not drained the pipe yet
      else if (e.code === "EPIPE") return; // nobody reads any more
      else throw e;
    }
  }
}

export const writeOut = (text) => writeAll(1, text);
export const writeErr = (text) => writeAll(2, text);

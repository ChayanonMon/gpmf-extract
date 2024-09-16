const MP4Box = require("mp4box");
const { readByBlocksWorker, readByBlocks } = require("./code/readBlock");
const InlineWorker = require("./code/inline-worker");

function toBuffer(ab) {
  return Buffer.from(ab);
}

function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function GPMFExtract(
  file,
  { browserMode, progress, useWorker = true, cancellationToken } = {}
) {
  if (!file) {
    return Promise.reject(new TypeError("File not provided"));
  }

  const isNode =
    typeof window === "undefined" && typeof process !== "undefined";
  const isBrowser = typeof window !== "undefined";

  let trackId;
  let nb_samples;
  let fileReaderByBlocks;
  let mp4boxFile = MP4Box.createFile();
  let uintArr;
  const timing = {};

  return new Promise(function (resolve, reject) {
    mp4boxFile.onError = function (e) {
      reject(new Error(`MP4Box Error: ${e}`));
    };

    mp4boxFile.onReady = function (videoData) {
      let foundVideo = false;
      for (let i = 0; i < videoData.tracks.length; i++) {
        const track = videoData.tracks[i];
        if (track.codec === "gpmd") {
          trackId = track.id;
          nb_samples = track.nb_samples;
          timing.start = new Date(track.created.getTime());
          // Correct the timezone offset
          timing.start = new Date(
            timing.start.getTime() - timing.start.getTimezoneOffset() * 60000
          );
        } else if (
          !foundVideo &&
          (track.type === "video" ||
            track.name === "VideoHandler" ||
            track.track_height > 0)
        ) {
          foundVideo = true;
          const vid = track;
          timing.videoDuration = vid.movie_duration / vid.movie_timescale;
          timing.frameDuration = timing.videoDuration / vid.nb_samples;
        }
      }

      if (trackId != null) {
        mp4boxFile.setExtractionOptions(trackId, null, {
          nbSamples: nb_samples,
        });

        mp4boxFile.onSamples = function (id, user, samples) {
          const totalSamples = samples.reduce((acc, cur) => acc + cur.size, 0);
          timing.samples = [];
          uintArr = new Uint8Array(totalSamples);
          let runningCount = 0;

          samples.forEach(function (sample) {
            timing.samples.push({
              cts: (sample.cts * 1000) / sample.timescale,
              duration: (sample.duration * 1000) / sample.timescale,
            });
            uintArr.set(new Uint8Array(sample.data), runningCount);
            runningCount += sample.size;
          });

          const rawData = isBrowser ? uintArr : toBuffer(uintArr);

          resolve({ rawData, timing });
        };

        mp4boxFile.start();
      } else {
        if (
          fileReaderByBlocks &&
          typeof fileReaderByBlocks.terminate === "function"
        ) {
          fileReaderByBlocks.terminate("Track not found");
        }
        reject(new Error("Track not found"));
      }
    };

    function onParsedBuffer(uint8array, offset) {
      const buffer = uint8array.buffer;
      if (buffer.byteLength === 0) {
        if (
          fileReaderByBlocks &&
          typeof fileReaderByBlocks.terminate === "function"
        ) {
          fileReaderByBlocks.terminate("File not compatible");
        }
        reject(new Error("File not compatible"));
        return;
      }
      buffer.fileStart = offset;
      if (cancellationToken?.cancelled) {
        if (
          fileReaderByBlocks &&
          typeof fileReaderByBlocks.terminate === "function"
        ) {
          fileReaderByBlocks.terminate("Canceled by user");
        }
        reject(new Error("Canceled by user"));
        return;
      }
      mp4boxFile.appendBuffer(buffer);
    }

    if (isBrowser) {
      if (useWorker && typeof window !== "undefined" && window.Worker) {
        fileReaderByBlocks = new InlineWorker(readByBlocksWorker);
        fileReaderByBlocks.onmessage = function (e) {
          const [messageType, ...args] = e.data;
          if (messageType === "progress" && progress) {
            progress(args[0]);
          } else if (messageType === "onParsedBuffer") {
            onParsedBuffer(args[0], args[1]);
          } else if (messageType === "flush") {
            mp4boxFile.flush();
          } else if (messageType === "onError") {
            reject(new Error(args[0]));
          }
        };

        fileReaderByBlocks.onerror = function (e) {
          // Terminate the worker and fallback
          fileReaderByBlocks.terminate();
          // Fallback to non-worker method
          fileReaderByBlocks = readByBlocks(file, {
            chunkSize: 2 * 1024 * 1024, // 2 MB
            progress,
            onParsedBuffer,
            flush: () => mp4boxFile.flush(),
            onError: (err) => reject(new Error(err)),
          });
        };

        fileReaderByBlocks.postMessage(["readBlock", file]);
      } else {
        fileReaderByBlocks = readByBlocks(file, {
          chunkSize: 2 * 1024 * 1024,
          progress,
          onParsedBuffer,
          flush: () => mp4boxFile.flush(),
          onError: (err) => reject(new Error(err)),
        });
      }
    } else if (isNode) {
      if (typeof file === "function") {
        file(mp4boxFile);
      } else if (typeof file === "string") {
        const fs = require("fs");
        const stream = fs.createReadStream(file, {
          highWaterMark: 16 * 1024 * 1024,
        });
        let bytesRead = 0;
        stream.on("data", (chunk) => {
          const arrayBuffer = chunk.buffer.slice(
            chunk.byteOffset,
            chunk.byteOffset + chunk.byteLength
          );
          arrayBuffer.fileStart = bytesRead;
          mp4boxFile.appendBuffer(arrayBuffer);
          bytesRead += chunk.length;
        });
        stream.on("end", () => {
          mp4boxFile.flush();
        });
        stream.on("error", (err) => {
          mp4boxFile.flush();
          reject(new Error(`Stream data error: ${err.message}`));
        });
      } else if (Buffer.isBuffer(file)) {
        const arrayBuffer = toArrayBuffer(file);
        if (arrayBuffer.byteLength === 0) {
          reject(new Error("File not compatible"));
          return;
        }
        arrayBuffer.fileStart = 0;
        mp4boxFile.appendBuffer(arrayBuffer);
      } else {
        reject(new Error("File not compatible"));
      }
    } else {
      reject(new Error("Unsupported environment"));
    }
  });
}

module.exports = GPMFExtract;

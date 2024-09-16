function createReader() {
  function readByBlocks(file, options) {
    const { chunkSize, progress, onParsedBuffer, flush, onError } = options;

    const fileSize = file.size || file.byteLength;
    let offset = 0;

    let pipeTo;
    const abortController = new AbortController();
    const terminate = (reason) => abortController.abort(reason);

    if (
      typeof window !== "undefined" &&
      typeof window.document !== "undefined"
    ) {
      // Browser main thread
      if (file.stream) {
        // Modern browsers
        const stream = file.stream();
        pipeTo = (write) =>
          stream.pipeTo(
            new WritableStream({ write }, { signal: abortController.signal })
          );
      } else {
        // Older browsers
        // Implement fallback if necessary
        onError("File streaming is not supported in this browser.");
        return;
      }
    } else if (typeof self !== "undefined" && typeof window === "undefined") {
      // Web Worker
      const stream = file.stream();
      pipeTo = (write) =>
        stream.pipeTo(
          new WritableStream({ write }, { signal: abortController.signal })
        );
    } else if (
      typeof process !== "undefined" &&
      process.versions != null &&
      process.versions.node != null
    ) {
      // Node.js
      const fs = require("fs");
      const path = require("path");

      let readStream;

      if (Buffer.isBuffer(file)) {
        // Handle Buffer input
        const { Readable } = require("stream");
        readStream = new Readable({
          read() {
            this.push(file);
            this.push(null);
          },
        });
      } else if (typeof file === "string" || file instanceof String) {
        // Handle file path
        readStream = fs.createReadStream(file, {
          highWaterMark: chunkSize,
          signal: abortController.signal,
        });
      } else {
        onError("Unsupported file type in Node.js environment.");
        return;
      }

      pipeTo = (write) =>
        new Promise((resolve, reject) => {
          readStream.on("data", (chunk) => {
            write(chunk);
          });
          readStream.on("end", resolve);
          readStream.on("error", reject);
        });
    } else {
      onError("Unsupported environment.");
      return;
    }

    return {
      terminate,
      result: pipeTo((chunk) => {
        onParsedBuffer(chunk, offset);
        offset += chunk.byteLength;

        const prog = Math.min(100, Math.ceil((offset / fileSize) * 100));
        if (progress) {
          progress(prog);
        }
      })
        .then((val) => {
          flush();
          return val;
        })
        .catch((err) => {
          onError(err.message || String(err));
        }),
    };
  }

  // Check if running in a worker
  if (typeof self !== "undefined" && typeof window === "undefined") {
    // Worker context
    self.onmessage = function (e) {
      if (e.data[0] === "readBlock") {
        const file = e.data[1];
        const { terminate } = readByBlocks(file, {
          chunkSize: 16 * 1024 * 1024, // 16 MB
          progress(progress) {
            self.postMessage(["progress", progress]);
          },
          onParsedBuffer(buffer, offset) {
            self.postMessage(["onParsedBuffer", buffer, offset], [buffer]);
          },
          flush() {
            self.postMessage(["flush"]);
          },
          onError(err) {
            self.postMessage(["onError", err]);
          },
        });

        self.onmessage = function (e) {
          if (e.data[0] === "terminate") {
            terminate();
          }
        };
      }
    };
  } else {
    // Main thread
    createReader.readByBlocks = readByBlocks;
    createReader.readByBlocksWorker = createReader;
  }
}

// Initialize worker or non-worker environment
createReader();

module.exports = createReader;
module.exports.readByBlocksWorker = createReader.readByBlocksWorker;
module.exports.readByBlocks = createReader.readByBlocks;

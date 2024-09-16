class InlineWorker {
  constructor(func, self = {}) {
    if (
      typeof Worker !== "undefined" &&
      typeof Blob !== "undefined" &&
      typeof URL !== "undefined"
    ) {
      const blob = new Blob(["(" + func.toString() + ")()"], {
        type: "text/javascript",
      });
      const url = URL.createObjectURL(blob);
      this.worker = new Worker(url);
    } else {
      // Fallback for environments without Worker support
      this.self = self;
      this.self.postMessage = (data) => {
        setTimeout(() => this.self.onmessage({ data }), 0);
      };
      setTimeout(() => func.call(self, self), 0);
    }
  }

  postMessage(data) {
    if (this.worker) {
      this.worker.postMessage(data);
    } else {
      setTimeout(() => this.self.onmessage({ data }), 0);
    }
  }

  set onmessage(handler) {
    if (this.worker) {
      this.worker.onmessage = handler;
    } else {
      this.self.onmessage = handler;
    }
  }
}

module.exports = InlineWorker;

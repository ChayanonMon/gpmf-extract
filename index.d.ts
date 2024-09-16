interface GPMFExtractCommonOptions {
  /** Default: true. In browser mode, use a web worker to avoid locking the browser. This is optional as it seems to crash on some recent browsers */
  useWorker?: boolean;
  /** Pass a function to read the processed percentage updates */
  progress?: (progress: number) => void;
}

interface GPMFExtractBrowserOptions extends GPMFExtractCommonOptions {
  browserMode: true;
  /**
   * An object that allows for cancelling the extraction process.
   * Currently only supported in browser mode.
   * If cancelled, the extraction process will fail with the error message "Canceled by user".
   */
  cancellationToken?: { cancelled: boolean };
}

interface GPMFExtractNodeOptions extends GPMFExtractCommonOptions {
  browserMode: false;
}

interface TimingInfo {
  /** Duration of video in seconds */
  videoDuration: number;
  /** Duration of frame in milliseconds */
  frameDuration: number;
  /** Date when the video capture started */
  start: Date;
  samples: {
    /** Composition time stamp */
    cts: number;
    duration: number;
  }[];
}

type ISOFile = {
  appendBuffer: (buffer: ArrayBuffer | Uint8Array) => void;
  flush: () => void;
};

/**
 * Finds the metadata track in GoPro (Hero5 and later) video files (or any other camera that implements GPMF) and extracts it for later analysis and processing.
 * @throws {'Track not found' | 'File not compatible' | 'Canceled by user'}
 */
declare function GPMFExtract(
  file: Blob | File,
  options: GPMFExtractBrowserOptions
): Promise<{
  rawData: Uint8Array;
  timing: TimingInfo;
}>;

declare function GPMFExtract(
  file: Buffer | ((file: ISOFile) => void),
  options: GPMFExtractNodeOptions
): Promise<{
  rawData: Buffer;
  timing: TimingInfo;
}>;

export default GPMFExtract;
export { GPMFExtract };

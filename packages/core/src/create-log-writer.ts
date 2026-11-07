export interface LogWriter {
  // Settles with the append's own result. An append after `close` writes nothing.
  readonly append: (text: string) => Promise<void>;

  // Settles once each append that came before it has, so nothing reaches the log after it.
  readonly close: () => Promise<void>;
}

// Each append waits for the one before it, so the app's stdout and stderr reach the log one chunk
// at a time, and a close knows the last write.
export function createLogWriter(appendLog: (text: string) => Promise<void>): LogWriter {
  let closed = false;
  let last: Promise<unknown> = Promise.resolve();

  const writeAfter = async (previous: Promise<unknown>, text: string): Promise<void> => {
    await previous;
    await appendLog(text);
  };

  return {
    append: (text) => {
      if (closed) {
        return Promise.resolve();
      }

      const writing = writeAfter(last, text);

      last = Promise.allSettled([writing]);

      return writing;
    },
    close: async () => {
      closed = true;

      await last;
    },
  };
}

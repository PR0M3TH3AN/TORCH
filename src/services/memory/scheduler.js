/**
 * @param {() => Promise<unknown> | unknown} task
 * @param {{ intervalMs: number }} options
 * @returns {{ stop: () => void }}
 */
export function startScheduler(task, options) {
  const handle = setInterval(() => {
    void task();
  }, options.intervalMs);

  return {
    stop() {
      clearInterval(handle);
    },
  };
}

/** Run an async finalizer at most once and share its result with every caller. */
export function onceAsync<Args extends unknown[], Result>(
  operation: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  let result: Promise<Result> | undefined;
  return (...args: Args) => {
    result ??= operation(...args);
    return result;
  };
}

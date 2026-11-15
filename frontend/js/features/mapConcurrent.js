// mapConcurrent.js — apply an async operation to a list without flooding its service.
// Results keep input order; after a failure, no new work starts and in-flight work is allowed to settle.
export async function mapConcurrent(items, concurrency, mapper) {
  const values = Array.from(items ?? []);
  const limit = Number(concurrency);
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("concurrency must be a positive integer");
  if (typeof mapper !== "function") throw new TypeError("mapper must be a function");
  if (!values.length) return [];

  const results = new Array(values.length);
  let next = 0;
  let failed = false;
  let failure;
  const worker = async () => {
    while (!failed) {
      const index = next++;
      if (index >= values.length) return;
      try {
        results[index] = await mapper(values[index], index, values);
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  if (failed) throw failure;
  return results;
}

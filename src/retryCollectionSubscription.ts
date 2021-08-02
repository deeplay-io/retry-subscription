import {delay, rethrowAbortError} from 'abort-controller-x';
import {AbortSignal} from 'node-abort-controller';
import isEqual = require('lodash.isequal');

export type RetryCollectionSubscriptionOptions<Value, Revision = Value> = {
  /**
   * Signal that can be used to abort retry backoff delays. It is also passed to
   * the inner subscription.
   */
  signal?: AbortSignal;
  /**
   * Starting delay before first retry attempt in milliseconds.
   *
   * Defaults to 1000.
   *
   * Example: if `baseMs` is 100, then retries will be attempted in 100ms,
   * 200ms, 400ms etc (not counting jitter).
   */
  baseMs?: number;
  /**
   * Maximum delay between attempts in milliseconds.
   *
   * Defaults to 15 seconds.
   *
   * Example: if `baseMs` is 1000 and `maxDelayMs` is 3000, then retries will be
   * attempted in 1000ms, 2000ms, 3000ms, 3000ms etc (not counting jitter).
   */
  maxDelayMs?: number;
  /**
   * Maximum for the total number of attempts.
   *
   * Defaults to `Infinity`.
   */
  maxAttempts?: number;
  /**
   * Called when an error is thrown by inner subscription, before setting delay
   * timer.
   *
   * If at the time of error the inner subscription was initialized (i.e. has
   * had initial emission), then the `attempt` and `delayMs` will be
   * `undefined`, and the retry will happen immediately.
   *
   * If the error happened before initialization, then the `attempt` will start
   * from 0 and will be incremented with each attempt, and the retry will happen
   * after exponential backoff.
   *
   * Rethrow error from this callback to prevent further retries.
   */
  onError?: (
    error: unknown,
    attempt: number | undefined,
    delayMs: number | undefined,
  ) => void;
  /**
   * If the value has a field that is changed each time the collection item
   * changes, consider returning supplying `getRevision` function that returns
   * it. This way, less memory will be needed to store the state, and less CPU
   * will be needed for diffing algorithm on resubscription.
   *
   * Defaults to identity function, i.e. the revision is the whole value.
   */
  getRevision?: (value: Value) => Revision;
  /**
   * Equality function used by diffing algorithm on resubscription.
   *
   * Defaults to deep equality.
   */
  equality?: (a: Revision, b: Revision) => boolean;
};

export type CollectionSubscriptionUpdate<Key extends string | number, Value> = {
  /**
   * Unique key of the item in the collection.
   */
  key: Key;
  /**
   * `undefined` if the item was removed from the collection.
   */
  value?: Value | undefined;
};

export async function* retryCollectionSubscription<
  Key extends string | number,
  Value,
  Revision = Value,
>(
  subscribe: (
    signal: AbortSignal,
  ) => AsyncIterable<Array<CollectionSubscriptionUpdate<Key, Value>>>,
  options: RetryCollectionSubscriptionOptions<Value, Revision> = {},
): AsyncIterable<Array<CollectionSubscriptionUpdate<Key, Value>>> {
  const {
    signal = new AbortController().signal,
    baseMs = 1000,
    maxDelayMs = 15000,
    maxAttempts = Infinity,
    onError,
    getRevision = value => value as unknown as Revision,
    equality = isEqual,
  } = options;

  let state = new Map<Key, Revision>();

  let attempt: number | undefined = 0;

  let outerCount = -1;

  while (true) {
    outerCount += 1;

    try {
      let innerCount = -1;

      for await (const updates of subscribe(signal)) {
        innerCount += 1;

        attempt = undefined;

        if (innerCount === 0 && outerCount !== 0) {
          const nextState = new Map<Key, Revision>();
          const diff: Array<CollectionSubscriptionUpdate<Key, Value>> = [];

          for (const {key, value} of updates) {
            if (value === undefined) {
              throw new Error(
                `Unexpected 'undefined' value at key '${key}' in initial emission`,
              );
            }

            const revision = getRevision(value);

            if (!state.has(key) || !equality(state.get(key)!, revision)) {
              diff.push({key, value});
            }

            state.delete(key);
            nextState.set(key, revision);
          }

          for (const key of state.keys()) {
            diff.push({key});
          }

          state = nextState;

          yield diff;
        } else {
          for (const {key, value} of updates) {
            if (value === undefined) {
              const deleted = state.delete(key);

              if (!deleted) {
                throw new Error(
                  `Unexpected 'undefined' value at key '${key}': previous value was already 'undefined'`,
                );
              }
            } else {
              state.set(key, getRevision(value));
            }
          }

          yield updates;
        }
      }

      return;
    } catch (error) {
      rethrowAbortError(error);

      if (attempt === undefined) {
        onError?.(error, undefined, undefined);

        attempt = 0;
      } else {
        if (attempt >= maxAttempts) {
          throw error;
        }

        // https://aws.amazon.com/ru/blogs/architecture/exponential-backoff-and-jitter/
        const backoff = Math.min(maxDelayMs, Math.pow(2, attempt) * baseMs);
        const delayMs = Math.round((backoff * (1 + Math.random())) / 2);

        onError?.(error, attempt, delayMs);

        await delay(signal, delayMs);

        attempt += 1;
      }
    }
  }
}

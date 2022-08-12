import {AsyncIterableX} from 'ix/asynciterable';
import {wrapWithAbort} from 'ix/asynciterable/operators';
import {
  retryCollectionSubscription as retry,
  CollectionSubscriptionUpdate,
} from '../retryCollectionSubscription';

export type RetryCollectionSubscriptionOptions<Value, Revision = Value> = {
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

export {CollectionSubscriptionUpdate};

class RetryCollectionSubscriptionAsyncIterable<
  Key extends string | number,
  Value,
  Revision = Value,
> extends AsyncIterableX<Array<CollectionSubscriptionUpdate<Key, Value>>> {
  constructor(
    private _source: AsyncIterable<
      Array<CollectionSubscriptionUpdate<Key, Value>>
    >,
    private _options: RetryCollectionSubscriptionOptions<Value, Revision>,
  ) {
    super();
  }

  [Symbol.asyncIterator](
    signal?: AbortSignal,
  ): AsyncIterator<Array<CollectionSubscriptionUpdate<Key, Value>>> {
    return retry(signal => wrapWithAbort(this._source, signal), {
      ...this._options,
      signal,
    })[Symbol.asyncIterator]();
  }
}

export function retryCollectionSubscription<
  Key extends string | number,
  Value,
  Revision = Value,
>(options: RetryCollectionSubscriptionOptions<Value, Revision>) {
  return function retryCollectionSubscriptionOperatorFunction(
    source: AsyncIterable<Array<CollectionSubscriptionUpdate<Key, Value>>>,
  ): AsyncIterableX<Array<CollectionSubscriptionUpdate<Key, Value>>> {
    return new RetryCollectionSubscriptionAsyncIterable<Key, Value, Revision>(
      source,
      options,
    );
  };
}

# retry-subscription [![npm version][npm-image]][npm-url] <!-- omit in toc -->

Automatically retry subscriptions with exponential backoff.

- [Installation](#installation)
- [Usage](#usage)
  - [Collection subscriptions](#collection-subscriptions)
  - [IxJS operators](#ixjs-operators)

## Installation

```
npm install retry-subscription
```

## Usage

### Collection subscriptions

Collection subscription is defined as a function returning an Async Iterable,
whose first emission represent initial collection state, and subsequent
emissions represent live changes:

```ts
type CollectionSubscription = (
  signal: AbortSignal,
) => AsyncIterable<Array<CollectionSubscriptionUpdate<Key, Value>>>;

type CollectionSubscriptionUpdate<Key extends string | number, Value> = {
  /**
   * Unique key of the item in the collection.
   */
  key: Key;
  /**
   * `undefined` if the item was removed from the collection.
   */
  value?: Value | undefined;
};
```

To add retries to a collection subscription, wrap it with
`retryCollectionSubscription`:

```ts
function retryCollectionSubscription<Key extends string | number, Value>(
  subscribe: (
    signal: AbortSignal,
  ) => AsyncIterable<Array<CollectionSubscriptionUpdate<Key, Value>>>,
  options?: RetryCollectionSubscriptionOptions<Value>,
): AsyncIterable<Array<CollectionSubscriptionUpdate<Key, Value>>>;
```

When an error happens, `retryCollectionSubscription` schedules a retry after
exponential backoff that grows with each attempt. Upon initial emission after
retry, attempt number is reset, the previous collection state is compared
against the received initial state, and the resulting Async Iterable only emits
the changes that happened during retry attempts.

Supported options:

```ts
type RetryCollectionSubscriptionOptions<Value, Revision = Value> = {
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
```

### IxJS operators

All functions are also exported in form of
[`IxJS`](https://github.com/ReactiveX/IxJS) operators from
`retry-subscription/ix` module.

[npm-image]: https://badge.fury.io/js/retry-subscription.svg
[npm-url]: https://badge.fury.io/js/retry-subscription

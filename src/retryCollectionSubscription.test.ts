import {AsyncSink} from 'ix/asynciterable';
import {mockRandom, resetMockRandom} from 'jest-mock-random';
import {
  retryCollectionSubscription,
  CollectionSubscriptionUpdate,
} from './retryCollectionSubscription';

beforeEach(() => {
  mockRandom(0.5);
});

afterEach(() => {
  resetMockRandom();
});

test('basic resubscription', async () => {
  type Updates = Array<CollectionSubscriptionUpdate<string, {test: string}>>;

  const sink1 = new AsyncSink<Updates>();
  const sink2 = new AsyncSink<Updates>();

  const subscribe = jest
    .fn<AsyncIterable<Updates>, []>()
    .mockImplementationOnce(() => sink1)
    .mockImplementationOnce(() => sink2);

  const onError = jest.fn<
    void,
    [error: unknown, attempt: number | undefined, delayMs: number | undefined]
  >();

  const it = retryCollectionSubscription(subscribe, {onError})[
    Symbol.asyncIterator
  ]();

  sink1.write([{key: '1', value: {test: '1-1'}}]);
  sink1.write([{key: '2', value: {test: '2-1'}}, {key: '1'}]);
  sink1.error(new Error('test-error'));

  sink2.write([
    {key: '2', value: {test: '2-1'}},
    {key: '1', value: {test: '1-2'}},
  ]);

  await expect(it.next()).resolves.toMatchInlineSnapshot(`
          Object {
            "done": false,
            "value": Array [
              Object {
                "key": "1",
                "value": Object {
                  "test": "1-1",
                },
              },
            ],
          }
        `);
  await expect(it.next()).resolves.toMatchInlineSnapshot(`
          Object {
            "done": false,
            "value": Array [
              Object {
                "key": "2",
                "value": Object {
                  "test": "2-1",
                },
              },
              Object {
                "key": "1",
              },
            ],
          }
        `);
  await expect(it.next()).resolves.toMatchInlineSnapshot(`
          Object {
            "done": false,
            "value": Array [
              Object {
                "key": "1",
                "value": Object {
                  "test": "1-2",
                },
              },
            ],
          }
        `);

  expect(onError.mock.calls).toMatchInlineSnapshot(`
    Array [
      Array [
        [Error: test-error],
        undefined,
        undefined,
      ],
    ]
  `);
});

test('backoff', async () => {
  type Updates = Array<CollectionSubscriptionUpdate<string, string>>;

  const sink1 = new AsyncSink<Updates>();
  const sink2 = new AsyncSink<Updates>();
  const sink3 = new AsyncSink<Updates>();
  const sink4 = new AsyncSink<Updates>();
  const sink5 = new AsyncSink<Updates>();

  const subscribe = jest
    .fn<AsyncIterable<Updates>, []>()
    .mockImplementationOnce(() => sink1)
    .mockImplementationOnce(() => sink2)
    .mockImplementationOnce(() => sink3)
    .mockImplementationOnce(() => sink4)
    .mockImplementationOnce(() => sink5);

  const onError = jest.fn<
    void,
    [error: unknown, attempt: number | undefined, delayMs: number | undefined]
  >();

  const it = retryCollectionSubscription(subscribe, {onError})[
    Symbol.asyncIterator
  ]();

  sink1.error(new Error('test-error-1'));
  sink2.error(new Error('test-error-2'));
  sink3.write([{key: '1', value: '1'}]);
  sink3.error(new Error('test-error-3'));
  sink4.error(new Error('test-error-4'));
  sink5.write([{key: '1', value: '1'}]);

  await expect(it.next()).resolves.toMatchInlineSnapshot(`
          Object {
            "done": false,
            "value": Array [
              Object {
                "key": "1",
                "value": "1",
              },
            ],
          }
        `);
  await expect(it.next()).resolves.toMatchInlineSnapshot(`
          Object {
            "done": false,
            "value": Array [],
          }
        `);

  expect(onError.mock.calls).toMatchInlineSnapshot(`
    Array [
      Array [
        [Error: test-error-1],
        0,
        750,
      ],
      Array [
        [Error: test-error-2],
        1,
        1500,
      ],
      Array [
        [Error: test-error-3],
        undefined,
        undefined,
      ],
      Array [
        [Error: test-error-4],
        0,
        750,
      ],
    ]
  `);
});

test('undefined value in initial emission', async () => {
  type Updates = Array<CollectionSubscriptionUpdate<string, {test: string}>>;

  const sink = new AsyncSink<Updates>();

  const it = retryCollectionSubscription(() => sink)[Symbol.asyncIterator]();

  sink.write([
    {key: '1', value: {test: '1'}},
    {key: '2', value: undefined},
  ]);

  await expect(it.next()).rejects.toMatchInlineSnapshot(
    `[Error: Misbehaving subscription source: unexpected 'undefined' value at key '2' in initial emission]`,
  );
});

test('undefined value in initial emission after retry', async () => {
  type Updates = Array<CollectionSubscriptionUpdate<string, {test: string}>>;

  const sink1 = new AsyncSink<Updates>();
  const sink2 = new AsyncSink<Updates>();

  const subscribe = jest
    .fn<AsyncIterable<Updates>, []>()
    .mockImplementationOnce(() => sink1)
    .mockImplementationOnce(() => sink2);

  const it = retryCollectionSubscription(subscribe)[Symbol.asyncIterator]();

  sink1.write([]);
  sink1.error(new Error('test-error'));

  sink2.write([{key: '1', value: undefined}]);

  await expect(it.next()).resolves.toMatchInlineSnapshot(`
          Object {
            "done": false,
            "value": Array [],
          }
        `);
  await expect(it.next()).rejects.toMatchInlineSnapshot(
    `[Error: Misbehaving subscription source: unexpected 'undefined' value at key '1' in initial emission]`,
  );
});

test('undefined value in for key not present in the state', async () => {
  type Updates = Array<CollectionSubscriptionUpdate<string, {test: string}>>;

  const sink = new AsyncSink<Updates>();

  const it = retryCollectionSubscription(() => sink)[Symbol.asyncIterator]();

  sink.write([]);
  sink.write([{key: '1', value: undefined}]);

  await expect(it.next()).resolves.toMatchInlineSnapshot(`
          Object {
            "done": false,
            "value": Array [],
          }
        `);
  await expect(it.next()).rejects.toMatchInlineSnapshot(
    `[Error: Misbehaving subscription source: unexpected 'undefined' value at key '1' which was not present in the state]`,
  );
});

/**
 * Compile-time assertions.
 *
 * Nothing here runs — `npm run typecheck` is the test. If an inference rule
 * regresses, `tsc` fails on the corresponding `Expect<...>` line. Kept out of
 * the vitest glob on purpose (`.test-d.ts`, not `.test.ts`).
 *
 * `AsyncResult` is not exported, so it is named here the only way users can
 * name it: by inferring it back out of a chain that turned asynchronous.
 */
import { Result, Tagged } from "../src";

type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
  ? true
  : false;
export type Expect<T extends true> = T;

class AError extends Tagged("AError") {
  constructor(readonly limit: number) {
    super();
  }
}
class BError extends Tagged("BError") {}
class CError extends Tagged("CError") {}

/** The unexported AsyncResult, recovered the way a user would meet it. */
type AsyncOf<T, E> = ReturnType<typeof asyncProbe<T, E>>;
declare function asyncProbe<T, E>(): ReturnType<
  ReturnType<typeof Result.registerExecution<[], Promise<Result<T, E>>>>
>;

// ── Result.ok / err ──────────────────────────────────────────────────────
export type _ok = Expect<Equal<typeof okNumber, Result<number, never>>>;
const okNumber = Result.ok(1);

export type _okVoid = Expect<Equal<typeof okVoid, Result<void, never>>>;
const okVoid = Result.ok();

export type _empty = Expect<Equal<typeof emptyResult, Result<null, never>>>;
const emptyResult = Result.empty();

export type _err = Expect<Equal<typeof errA, Result<never, AError>>>;
const errA = Result.err(new AError(1));

// A widened `_tag` must be rejected — otherwise error tracking silently dies.
class Widened {
  readonly _tag: string = "Widened";
}
// @ts-expect-error _tag widened to `string`
Result.err(new Widened());

// ── registerExecution collapses a union of results into a result of unions ─
const registered = Result.registerExecution((n: number) => {
  if (n === 0) return Result.err(new AError(0));
  if (n < 0) return Result.err(new BError());
  return Result.ok(n.toString());
});
export type _registered = Expect<
  Equal<ReturnType<typeof registered>, Result<string, AError | BError>>
>;
export type _registeredArgs = Expect<Equal<Parameters<typeof registered>, [number]>>;

// ── the same call, async, produces an AsyncResult ────────────────────────
const registeredAsync = Result.registerExecution(async (id: string) => {
  if (id === "") return Result.err(new AError(0));
  return Result.ok({ id });
});
export type _registeredAsync = Expect<
  Equal<ReturnType<typeof registeredAsync>, AsyncOf<{ id: string }, AError>>
>;
// The chain is not thenable, so `getResult()` — not `await` — is what yields
// the Result. `Awaited` on the chain itself is a no-op, and that is asserted too.
export type _resolvesToResult = Expect<
  Equal<
    Awaited<ReturnType<ReturnType<typeof registeredAsync>["getResult"]>>,
    Result<{ id: string }, AError>
  >
>;
export type _notThenable = Expect<
  Equal<Awaited<ReturnType<typeof registeredAsync>>, ReturnType<typeof registeredAsync>>
>;

// ── mapValue: sync stays sync, async turns async ─────────────────────────
export type _mapValueSync = Expect<Equal<typeof mapped, Result<string, AError | BError | CError>>>;
const mapped = registered(1).mapValue((s) =>
  s.length > 0 ? Result.ok(s) : Result.err(new CError()),
);

export type _mapValueAsync = Expect<
  Equal<typeof mappedAsync, AsyncOf<number, AError | BError | CError>>
>;
const mappedAsync = registered(1).mapValue(async (s) =>
  s.length > 0 ? Result.ok(s.length) : Result.err(new CError()),
);

// A callback returning an AsyncResult turns the chain async just the same.
export type _mapValueNested = Expect<Equal<typeof mappedNested, AsyncOf<{ id: string }, AError>>>;
const mappedNested = Result.ok("x").mapValue((s) => registeredAsync(s));

// A callback with one sync and one async branch counts as async.
export type _mapValueMixed = Expect<Equal<typeof mappedMixed, AsyncOf<number, CError>>>;
const mappedMixed = Result.ok(1).mapValue((n) =>
  n > 0 ? Result.ok(n) : Promise.resolve(Result.err(new CError())),
);

// ── mapError replaces the union and keeps the value ──────────────────────
export type _mapError = Expect<Equal<typeof replaced, Result<string | number, CError>>>;
const replaced = registered(1).mapError(() =>
  Math.random() > 0.5 ? Result.ok(0) : Result.err(new CError()),
);

export type _mapErrorAsync = Expect<Equal<typeof replacedAsync, AsyncOf<string | number, CError>>>;
const replacedAsync = registered(1).mapError(async () =>
  Math.random() > 0.5 ? Result.ok(0) : Result.err(new CError()),
);

// ── handleError subtracts exactly the classes named ──────────────────────
export type _handleOne = Expect<Equal<typeof handledOne, Result<string | number, BError>>>;
const handledOne = registered(1).handleError(AError, (e) => Result.ok(e.limit));

export type _handleBoth = Expect<Equal<typeof handledBoth, Result<string | number, never>>>;
const handledBoth = registered(1)
  .handleError(AError, (e) => Result.ok(e.limit))
  .handleError(BError, () => Result.ok(0));

// Several classes in one call subtract all of them at once.
export type _handleMulti = Expect<Equal<typeof handledMulti, Result<string | number, never>>>;
const handledMulti = registered(1).handleError(AError, BError, () => Result.ok(0));

// A handler may introduce a new error, which lands back in the union.
export type _handleIntroduces = Expect<
  Equal<typeof handledIntroduces, Result<string, BError | CError>>
>;
const handledIntroduces = registered(1).handleError(AError, () => Result.err(new CError()));

// An async handler turns the chain async without changing the subtraction.
export type _handleAsync = Expect<Equal<typeof handledAsync, AsyncOf<string | number, BError>>>;
const handledAsync = registered(1).handleError(AError, async (e) => Result.ok(e.limit));

// The handler parameter is narrowed to the listed classes.
registered(1).handleError(AError, (e) => {
  const limit: number = e.limit;
  return Result.ok(limit);
});

// ── handleError rejects a class that cannot be in the union ──────────────
// A class that was never in it.
// @ts-expect-error CError is not part of AError | BError
registered(1).handleError(CError, () => Result.ok(0));

// A class already subtracted by an earlier call.
registered(1)
  .handleError(AError, () => Result.ok(0))
  // @ts-expect-error AError is gone from the union
  .handleError(AError, () => Result.ok(0));

// Nothing at all, once the union is `never`.
// @ts-expect-error an ok Result has no errors to handle
Result.ok(1).handleError(AError, () => Result.ok(0));

// The offending class is rejected on its own, not the whole call.
// @ts-expect-error CError is not part of AError | BError
registered(1).handleError(AError, CError, () => Result.ok(0));

// The same guard applies to an asynchronous chain.
// @ts-expect-error BError is not part of AError
registeredAsync("x").handleError(BError, () => Result.ok(0));

// A base class still names a union member that subclasses it, because matching
// is `instanceof`.
class SubAError extends AError {}
export type _handleSubclass = Expect<Equal<typeof handledSubclass, Result<number, never>>>;
const handledSubclass = Result.err<SubAError>(new SubAError(1)).handleError(AError, (e) =>
  Result.ok(e.limit),
);

// ── tap keeps both types, but an async effect turns the chain async ──────
export type _tapSync = Expect<Equal<typeof tapped, Result<string, AError | BError>>>;
const tapped = registered(1).tap(() => {});

export type _tapAsync = Expect<Equal<typeof tappedAsync, AsyncOf<string, AError | BError>>>;
const tappedAsync = registered(1).tap(async () => {});

// ── try follows the same rule ────────────────────────────────────────────
export type _trySync = Expect<Equal<typeof triedSync, Result<number, CError>>>;
const triedSync = Result.try(
  () => 1,
  () => new CError(),
);

export type _tryAsync = Expect<Equal<typeof triedAsync, AsyncOf<number, CError>>>;
const triedAsync = Result.try(
  async () => 1,
  () => new CError(),
);

// ── all() builds a tuple, and goes async if any member is ────────────────
export type _all = Expect<Equal<typeof combined, Result<[string, string], AError | BError>>>;
const combined = Result.all([registered(1), registered(2)]);

export type _allAsync = Expect<
  Equal<typeof combinedAsync, AsyncOf<[string, { id: string }], AError | BError>>
>;
const combinedAsync = Result.all([registered(1), registeredAsync("x")]);

export type _allEmpty = Expect<Equal<typeof combinedEmpty, Result<[], never>>>;
const combinedEmpty = Result.all([]);

// ── collect() keeps every error, positionally, with null where it succeeded ─
export type _collect = Expect<
  Equal<
    typeof collected,
    Result<[string, string], [AError | BError | null, AError | BError | null]>
  >
>;
const collected = Result.collect([registered(1), registered(2)]);

// Distinct error types stay at their own index rather than collapsing.
export type _collectDistinct = Expect<
  Equal<typeof collectedDistinct, Result<[string, number], [AError | BError | null, CError | null]>>
>;
const collectedDistinct = Result.collect([
  registered(1),
  Math.random() > 0.5 ? Result.ok(1) : Result.err(new CError()),
]);

export type _collectAsync = Expect<
  Equal<
    typeof collectedAsync,
    AsyncOf<[string, { id: string }], [AError | BError | null, AError | null]>
  >
>;
const collectedAsync = Result.collect([registered(1), registeredAsync("x")]);

export type _collectEmpty = Expect<Equal<typeof collectedEmpty, Result<[], []>>>;
const collectedEmpty = Result.collect([]);

// ── terminals ────────────────────────────────────────────────────────────
export type _match = Expect<Equal<typeof matched, string>>;
const matched = registered(1).match({ ok: (s) => s, err: (e) => e._tag });

export type _unwrapOr = Expect<Equal<typeof withFallback, string | null>>;
const withFallback = registered(1).unwrapOr(null);

export type _unwrap = Expect<Equal<ReturnType<typeof unwrapFn>, string>>;
const unwrapFn = () => registered(1).unwrap();

// A chain has no terminals — getResult() first, then the Result's terminals.
export type _resolveChain = Expect<
  Equal<ReturnType<typeof resolveChainFn>, Promise<Result<string, AError>>>
>;
const resolveChainFn = () => mappedNested.mapValue((o) => Result.ok(o.id)).getResult();

// Keep the bindings "used" so `noUnusedLocals` stays on for real code.
export const _bindings = [
  okNumber,
  okVoid,
  emptyResult,
  errA,
  mapped,
  mappedAsync,
  mappedNested,
  mappedMixed,
  replaced,
  replacedAsync,
  handledOne,
  handledBoth,
  handledMulti,
  handledIntroduces,
  handledAsync,
  handledSubclass,
  tapped,
  tappedAsync,
  triedSync,
  triedAsync,
  combined,
  combinedAsync,
  combinedEmpty,
  collected,
  collectedDistinct,
  collectedAsync,
  collectedEmpty,
  matched,
  withFallback,
  unwrapFn,
  resolveChainFn,
];

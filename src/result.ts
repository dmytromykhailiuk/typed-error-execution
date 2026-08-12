import type {
  ErrorClass,
  HandleableClasses,
  MatchedBy,
  RequireLiteralTag,
  Tagged,
  UnmatchedBy,
} from "./types";

/** Any `Result`, used as a constraint where the parameters do not matter. */
export type AnyResult = Result<any, any>;

/** Any `AsyncResult`, used as a constraint where the parameters do not matter. */
export type AnyAsyncResult = AsyncResult<any, any>;

/**
 * Everything a callback in a chain is allowed to return: a `Result`, an
 * `AsyncResult`, or a promise of a `Result`.
 */
export type ResultLike = AnyResult | AnyAsyncResult | Promise<AnyResult>;

/** Extracts the success type out of any of the three result shapes. */
export type InferOk<R> = R extends Result<infer T, any>
  ? T
  : R extends AsyncResult<infer T, any>
    ? T
    : R extends Promise<Result<infer T, any>>
      ? T
      : never;

/** Extracts the error union out of any of the three result shapes. */
export type InferErr<R> = R extends Result<any, infer E>
  ? E
  : R extends AsyncResult<any, infer E>
    ? E
    : R extends Promise<Result<any, infer E>>
      ? E
      : never;

/**
 * Whether any member of `R` is asynchronous.
 *
 * `Extract` is wrapped in a tuple so the check does not distribute: a callback
 * with one sync branch and one async branch must count as asynchronous, not
 * produce a `Result | AsyncResult` union nobody can chain on.
 */
type IsAsync<R> = [Extract<R, AnyAsyncResult | Promise<unknown>>] extends [never] ? false : true;

/**
 * Whether any member of `T` is a promise.
 *
 * Separate from {@link IsAsync} because `try` wraps a callback returning a
 * *raw value*, not a result — an `AsyncResult` coming back from it would be an
 * ordinary value to wrap, not a chain to continue.
 */
type IsPromise<T> = [Extract<T, Promise<unknown>>] extends [never] ? false : true;

/**
 * The type a chaining method returns: `AsyncResult` when the callback was
 * asynchronous, plain `Result` when it was not.
 *
 * `TKeep` and `EKeep` are the parts of the incoming value and error types that
 * survive the step — `mapValue` keeps no value but every error, `mapError`
 * keeps the value but no error, `handleError` keeps the value and the errors it
 * did not name.
 */
export type Chain<R, TKeep, EKeep> = IsAsync<R> extends true
  ? AsyncResult<TKeep | InferOk<R>, EKeep | InferErr<R>>
  : Result<TKeep | InferOk<R>, EKeep | InferErr<R>>;

/** Like {@link Chain}, but the value and error are unchanged — used by `tap`. */
type TapChain<R, T, E> = IsAsync<R> extends true ? AsyncResult<T, E> : Result<T, E>;

/** Maps a tuple of results to the tuple of their success types. */
export type InferOkTuple<Rs extends readonly ResultLike[]> = {
  -readonly [K in keyof Rs]: InferOk<Rs[K]>;
};

/**
 * Maps a tuple of results to the tuple of their error types, each widened with
 * `null` for the positions that succeeded. This is the error type of
 * {@link Result.collect} — it is a tuple, not a union, so the index of a
 * failure is preserved.
 */
export type InferErrTuple<Rs extends readonly ResultLike[]> = {
  -readonly [K in keyof Rs]: InferErr<Rs[K]> | null;
};

/**
 * Thrown by `unwrap()` / `unwrapError()` when the `Result` is on the other
 * side. It carries the original error so nothing is lost.
 */
export class ResultUnwrapError extends Error {
  readonly _tag = "ResultUnwrapError" as const;

  constructor(
    message: string,
    /** The tagged error the `Result` was carrying, or `undefined` on an ok. */
    readonly taggedError: unknown,
  ) {
    super(message);
    this.name = "ResultUnwrapError";
  }
}

/**
 * Lifts whatever a callback returned into an `AsyncResult`, or reports that it
 * was synchronous.
 *
 * Both an `AsyncResult` and a bare `Promise` have to be checked. Returning
 * `null` for the synchronous case keeps the decision in one place instead of
 * repeating the two `instanceof` tests at every call site.
 */
function liftAsync(value: unknown): AnyAsyncResult | null {
  if (value instanceof AsyncResult) return value;
  if (value instanceof Promise) return AsyncResult.from(value);
  return null;
}

/**
 * Normalises whatever a callback returned into something a promise chain can
 * absorb: a `Result`, or a promise of one.
 *
 * `AsyncResult` is deliberately **not** thenable, so the promise machinery will
 * not unwrap it on its own — without this, a callback like
 * `mapValue((id) => fetchUser(id))` would resolve to the `AsyncResult` object
 * instead of the `Result` inside it.
 */
function settle(value: unknown): AnyResult | Promise<AnyResult> {
  return value instanceof AsyncResult ? value.getResult() : (value as AnyResult);
}

/**
 * Runtime check for "is this thing one of our tagged errors?".
 *
 * Useful at the edges — a `catch` block, a message queue consumer — where the
 * value arrives as `unknown`.
 */
function isTaggedError(value: unknown): value is Tagged {
  return typeof value === "object" && value !== null && typeof (value as Tagged)._tag === "string";
}

/**
 * Whether `fn` was declared with `async`.
 *
 * A skipped step never calls its callback, so there is no returned value to
 * inspect — but the function object still says whether it was declared `async`,
 * and that covers the overwhelmingly common form. Detection is exact for every
 * `async` shape (arrow, declaration, method, bound) and `false` for a plain
 * function that merely happens to return a promise.
 */
function isAsyncFunction(fn: unknown): boolean {
  // `Object.prototype.toString` reads the intrinsic tag, so it survives a
  // shadowed `constructor` and covers arrows, declarations, methods and bound
  // async functions alike.
  return Object.prototype.toString.call(fn) === "[object AsyncFunction]";
}

/**
 * What a **skipped** step hands back.
 *
 * The step's inferred type is asynchronous exactly when its callback is, so a
 * provably `async` callback yields a real `AsyncResult` even though nothing
 * ran. Anything else is assumed synchronous.
 *
 * Getting that assumption wrong is harmless: `AsyncResult`'s surface is a
 * subset of `Result`'s, so a `Result` standing in for a chain supports every
 * call the chain's type permits — chaining, or `getResult()`. The check is
 * therefore about making `instanceof` agree with the type, not about
 * correctness.
 */
function skip<T, E>(result: Result<T, E>, fn: unknown): never {
  return (isAsyncFunction(fn) ? result.toAsync() : result) as never;
}

/** Renders an error for an `unwrap()` failure message. */
function describeError(error: unknown): string {
  if (isTaggedError(error)) return error._tag;
  if (Array.isArray(error)) {
    return `[${error.map((e) => (isTaggedError(e) ? e._tag : String(e))).join(", ")}]`;
  }
  return String(error);
}

/**
 * A computation that either succeeded with a `T` or failed with one of the
 * tagged errors in `E`.
 *
 * Every chaining method accepts a synchronous **or** asynchronous callback and
 * decides what to return by looking at what the callback actually produced. Give
 * it a `Result` and you get a `Result`; give it a promise or an `AsyncResult`
 * and the chain becomes asynchronous from that point on.
 */
export class Result<T, E> {
  private constructor(
    private readonly _isOk: boolean,
    private readonly _value: T | undefined,
    private readonly _error: E | undefined,
  ) {}

  // ── constructors ──────────────────────────────────────────────────────

  /** A success carrying nothing. */
  static ok(): Result<void, never>;
  /** A success carrying `value`. */
  static ok<T>(value: T): Result<T, never>;
  static ok(value?: unknown) {
    return new Result(true, value, undefined);
  }

  /**
   * A success carrying `null`.
   *
   * Distinct from `ok()` because `null` is a real value you can branch on,
   * whereas `void` is the absence of one. Handy as the "nothing to do, and
   * that's fine" branch of an error handler.
   */
  static empty(): Result<null, never> {
    return Result.ok(null);
  }

  /**
   * A failure carrying a tagged error.
   *
   * The error's `_tag` must be a string literal — that is what makes the error
   * union in the return type meaningful. Passing an error whose tag widened to
   * `string` is a compile error.
   */
  static err<E extends Tagged>(error: E & RequireLiteralTag<E>): Result<never, E> {
    return new Result<never, E>(false, undefined, error as E);
  }

  // ── interop with throwing code ────────────────────────────────────────

  /**
   * Runs `fn` and converts anything it throws into a tagged error.
   *
   * This is the bridge from the throwing world (`JSON.parse`, a third-party
   * SDK, your own legacy code) into the typed one. If `fn` returns a promise,
   * the rejection is converted too and you get an asynchronous chain back.
   *
   * `onThrow` receives the thrown value as `unknown` — it may be anything,
   * JavaScript does not guarantee it is an `Error`.
   *
   * ```ts
   * Result.try(() => JSON.parse(raw) as Config, (e) => new ParseError(String(e)));
   * // Result<Config, ParseError>
   *
   * Result.try(() => sdk.fetchUser(id), (e) => new SdkError(String(e)));
   * // AsyncResult<User, SdkError>
   * ```
   */
  static try<T, E extends Tagged>(
    fn: () => T,
    onThrow: (thrown: unknown) => E & RequireLiteralTag<E>,
  ): IsPromise<T> extends true ? AsyncResult<Awaited<T>, E> : Result<T, E> {
    try {
      const produced = fn();
      if (!(produced instanceof Promise)) return Result.ok(produced) as never;

      return AsyncResult.from(
        produced.then(
          (value: Awaited<T>) => Result.ok(value),
          (thrown: unknown) => Result.err(onThrow(thrown) as never),
        ),
      ) as never;
    } catch (thrown) {
      // `fn` threw before returning anything, so there is nothing to inspect —
      // the caller gets a synchronous Result. See `getResult` on why that is
      // safe even when the declared type says AsyncResult.
      return Result.err(onThrow(thrown) as never) as never;
    }
  }

  /**
   * Lifts a throwing function once, into a function that returns a `Result`.
   *
   * Same conversion as {@link Result.try}, but it wraps instead of runs: you
   * name the throwing call and the error it becomes one time, at the boundary
   * of your typed code, and every call site afterwards is ordinary. Arguments
   * and the sync/async rule pass straight through.
   *
   * ```ts
   * const parseJson = Result.fromThrowable(
   *   (raw: string) => JSON.parse(raw) as Config,
   *   (thrown) => new ParseError(String(thrown)),
   * );
   * // (raw: string) => Result<Config, ParseError>
   *
   * const fetchUser = Result.fromThrowable(
   *   (id: string) => sdk.users.get(id),
   *   (thrown) => new SdkError(String(thrown)),
   * );
   * // (id: string) => AsyncResult<User, SdkError>
   * ```
   *
   * Annotate what the throwing call returns, as above. Handing over a function
   * typed `any` — `Result.fromThrowable(JSON.parse, …)` — leaves the compiler
   * no way to tell a promise from a value, and it errs towards the asynchronous
   * type, which is the safe direction but not the one you want here.
   */
  static fromThrowable<A extends any[], T, E extends Tagged>(
    fn: (...args: A) => T,
    onThrow: (thrown: unknown) => E & RequireLiteralTag<E>,
  ): (...args: A) => IsPromise<T> extends true ? AsyncResult<Awaited<T>, E> : Result<T, E> {
    // Instantiated explicitly: inferring `E` again here would re-apply the
    // literal-tag guard to a type that already carries it.
    return (...args: A) => Result.try<T, E>(() => fn(...args), onThrow);
  }

  // ── registration ──────────────────────────────────────────────────────

  /**
   * Freezes the error union of a function into its signature.
   *
   * Inside the function you return `Result.ok(...)` and `Result.err(...)`
   * freely; TypeScript infers the union of every branch and this collapses it
   * into one concrete `Result<T, E1 | E2 | ...>` return type. Without it the
   * call site sees a union *of results* rather than a result of unions, and
   * chaining on it is miserable.
   *
   * Works for `async` functions too — the returned function then hands back an
   * `AsyncResult`, so callers can chain without an `await`.
   *
   * ```ts
   * const findUser = Result.registerExecution((id: string) =>
   *   db[id] ? Result.ok(db[id]) : Result.err(new NotFoundError(id)),
   * );
   * // (id: string) => Result<User, NotFoundError>
   *
   * const fetchUser = Result.registerExecution(async (id: string) =>
   *   (await db.query(id)) ? Result.ok(row) : Result.err(new NotFoundError(id)),
   * );
   * // (id: string) => AsyncResult<Row, NotFoundError>
   * ```
   */
  static registerExecution<A extends any[], R extends ResultLike>(
    fn: (...args: A) => R,
  ): (...args: A) => Chain<R, never, never> {
    return ((...args: A) => {
      const produced = fn(...args);
      return (liftAsync(produced) ?? produced) as never;
    }) as never;
  }

  // ── combinators ───────────────────────────────────────────────────────

  /**
   * Collects a tuple of results into a result of a tuple.
   *
   * Short-circuits on the **first** error in argument order. If any member is
   * asynchronous the whole thing is, and every member runs concurrently — but
   * the reported error is still the first in argument order, not the first to
   * settle in time, so the outcome is deterministic.
   *
   * ```ts
   * Result.all([parseName(a), parseAge(b)]);
   * // Result<[string, number], ParseError | RangeError>
   *
   * Result.all([fetchUser(id), parseConfig(raw)]);
   * // AsyncResult<[User, Config], NotFoundError | ParseError>
   * ```
   */
  static all<const Rs extends readonly ResultLike[]>(
    results: Rs,
  ): IsAsync<Rs[number]> extends true
    ? AsyncResult<InferOkTuple<Rs>, InferErr<Rs[number]>>
    : Result<InferOkTuple<Rs>, InferErr<Rs[number]>> {
    if (results.some((r) => liftAsync(r) !== null)) {
      const settle = async () => {
        const settled = await Promise.all(
          results.map((r) => {
            const async = liftAsync(r);
            return async ? async.getResult() : (r as AnyResult);
          }),
        );
        return Result.combineFirst(settled);
      };
      return AsyncResult.from(settle()) as never;
    }

    return Result.combineFirst(results as readonly AnyResult[]) as never;
  }

  /**
   * Like {@link Result.all} for values, but it keeps **every** error instead of
   * stopping at the first.
   *
   * On success you get the same tuple of values. On failure the error is a
   * tuple the same length as the input, holding each member's error at its own
   * index and `null` where that member succeeded — so you can tell *which*
   * inputs failed, not merely that one did.
   *
   * ```ts
   * const form = Result.collect([validateName(a), validateAge(b), validateEmail(c)]);
   * // Result<
   * //   [string, number, string],
   * //   [NameError | null, AgeError | null, EmailError | null]
   * // >
   *
   * form.error; // [NameError, null, EmailError] — age was fine
   * ```
   *
   * The error is a tuple rather than a tagged error, so `handleError()` cannot
   * match on it — read it with `match()` or `error` and turn it into whatever
   * your application reports. Use {@link Result.all} when you only care that
   * something failed; use this when you have to show every failure at once.
   */
  static collect<const Rs extends readonly ResultLike[]>(
    results: Rs,
  ): IsAsync<Rs[number]> extends true
    ? AsyncResult<InferOkTuple<Rs>, InferErrTuple<Rs>>
    : Result<InferOkTuple<Rs>, InferErrTuple<Rs>> {
    if (results.some((r) => liftAsync(r) !== null)) {
      const gather = async () => {
        const settled = await Promise.all(
          results.map((r) => {
            const async = liftAsync(r);
            return async ? async.getResult() : (r as AnyResult);
          }),
        );
        return Result.combineEvery(settled);
      };
      return AsyncResult.from(gather()) as never;
    }

    return Result.combineEvery(results as readonly AnyResult[]) as never;
  }

  /** Shared tail of `all`: first error wins, otherwise a tuple of values. */
  private static combineFirst(results: readonly AnyResult[]): AnyResult {
    const values: unknown[] = [];
    for (const result of results) {
      if (!result.isOk) return result;
      values.push(result.value);
    }
    return Result.ok(values);
  }

  /**
   * Shared tail of `collect`: a tuple of values, or a tuple of errors with
   * `null` in the positions that succeeded.
   */
  private static combineEvery(results: readonly AnyResult[]): AnyResult {
    const values: unknown[] = [];
    const errors: unknown[] = [];
    let failed = false;

    for (const result of results) {
      values.push(result.value);
      errors.push(result.isOk ? null : result.error);
      if (!result.isOk) failed = true;
    }

    // Bypasses `err()` on purpose: the error here is a tuple, not a tagged
    // error, so the literal-tag guard does not apply to it.
    return failed ? new Result(false, undefined, errors) : Result.ok(values);
  }

  // ── inspection ────────────────────────────────────────────────────────

  /** `true` when this is a success. */
  get isOk(): boolean {
    return this._isOk;
  }

  /** `true` when this is a failure. */
  get isErr(): boolean {
    return !this._isOk;
  }

  /** The success value, or `undefined` when this is a failure. */
  get value(): T | undefined {
    return this._value;
  }

  /** The tagged error, or `undefined` when this is a success. */
  get error(): E | undefined {
    return this._error;
  }

  /**
   * Resolves this result as a promise.
   *
   * On a synchronous result there is nothing to wait for, so this is the
   * identity wrapped in a promise. It exists because it is the **one bridge**
   * out of an asynchronous chain, and both classes must offer it identically:
   * a step that short-circuits synchronously still carries the type of an
   * asynchronous chain, and `getResult()` is what the caller will reach for.
   */
  getResult(): Promise<Result<T, E>> {
    return Promise.resolve(this);
  }

  /** Lifts this `Result` into an already-settled `AsyncResult`. */
  toAsync(): AsyncResult<T, E> {
    return AsyncResult.from(this.getResult());
  }

  /**
   * Collapses both sides into one plain value. The exhaustive, type-safe way
   * out of a `Result` — you cannot forget a branch.
   *
   * ```ts
   * const label = result.match({
   *   ok: (user) => `Hello, ${user.name}`,
   *   err: (e) => `Failed: ${e._tag}`,
   * });
   * ```
   */
  match<A, B = A>(matchers: {
    ok: (value: T) => A;
    err: (error: E) => B;
  }): A | B {
    return this._isOk ? matchers.ok(this._value as T) : matchers.err(this._error as E);
  }

  /**
   * Returns the success value, or throws {@link ResultUnwrapError}.
   *
   * Reserve this for the top of your program and for tests. Reaching for it
   * mid-chain throws away the very guarantee you adopted the library for.
   */
  unwrap(): T {
    if (!this._isOk) {
      throw new ResultUnwrapError(
        `Called unwrap() on an error Result (${describeError(this._error)})`,
        this._error,
      );
    }
    return this._value as T;
  }

  /** Returns the tagged error, or throws {@link ResultUnwrapError} on a success. */
  unwrapError(): E {
    if (this._isOk) {
      throw new ResultUnwrapError("Called unwrapError() on an ok Result", undefined);
    }
    return this._error as E;
  }

  /** Returns the success value, or `fallback` when this is a failure. */
  unwrapOr<D>(fallback: D): T | D {
    return this._isOk ? (this._value as T) : fallback;
  }

  /** Returns the success value, or computes a fallback from the error. */
  unwrapOrElse<D>(fn: (error: E) => D): T | D {
    return this._isOk ? (this._value as T) : fn(this._error as E);
  }

  // ── transformation ────────────────────────────────────────────────────

  /**
   * Runs a side effect on the success value and returns the result unchanged.
   * For logging and metrics — the callback's value is ignored, but if it is a
   * promise the chain becomes asynchronous and waits for it.
   */
  tap<R extends void | Promise<void>>(fn: (value: T) => R): TapChain<R, T, E> {
    if (!this._isOk) return skip(this, fn);
    const produced: unknown = fn(this._value as T);
    if (!(produced instanceof Promise)) return this as never;
    return AsyncResult.from(produced.then(() => this)) as never;
  }

  /** Runs a side effect on the error and returns the result unchanged. */
  tapError<R extends void | Promise<void>>(fn: (error: E) => R): TapChain<R, T, E> {
    if (this._isOk) return skip(this, fn);
    const produced: unknown = fn(this._error as E);
    if (!(produced instanceof Promise)) return this as never;
    return AsyncResult.from(produced.then(() => this)) as never;
  }

  /**
   * Runs `fn` on the success value; passes a failure through untouched.
   *
   * `fn` returns a result, so it may introduce new errors — those are added to
   * the error union. Return a promise or an `AsyncResult` and the chain
   * continues asynchronously. This is the workhorse of the library.
   *
   * ```ts
   * fetchUser(id)                          // Result<User, NotFoundError>
   *   .mapValue((u) => parseAge(u.age))    // Result<number, NotFoundError | ParseError>
   *   .mapValue(async (a) => Result.ok(a)) // AsyncResult<number, NotFoundError | ParseError>
   * ```
   */
  mapValue<R extends ResultLike>(fn: (value: T) => R): Chain<R, never, E> {
    if (!this._isOk) return skip(this, fn);
    const produced = fn(this._value as T);
    return (liftAsync(produced) ?? produced) as never;
  }

  /**
   * Runs `fn` on the error; passes a success through untouched.
   *
   * Because `fn` sees the whole error union at once, the resulting error type
   * is *replaced* rather than narrowed. To deal with specific error types and
   * leave the rest alone, use {@link Result.handleError}.
   */
  mapError<R extends ResultLike>(fn: (error: E) => R): Chain<R, T, never> {
    if (this._isOk) return skip(this, fn);
    const produced = fn(this._error as E);
    return (liftAsync(produced) ?? produced) as never;
  }

  /**
   * Handles one or more specific error classes and removes exactly those from
   * the error union. Everything else flows on untouched.
   *
   * Pass the error classes first and the handler last. Matching is
   * `instanceof`, so a subclass of a listed class is handled too — including a
   * whole family built with `Tagged(tag, Parent)`, at any depth. An
   * asynchronous handler turns the chain asynchronous.
   *
   * ```ts
   * chain
   *   .handleError(NotFoundError, () => Result.ok(defaultUser))
   *   .handleError(TimeoutError, RateLimitError, (e) => Result.err(new RetryLater(e)));
   * ```
   *
   * Every class you name must still be in the union — handling one twice, or
   * handling anything at all once the union is `never`, is a compile error
   * rather than a step that quietly never runs. See {@link HandleableClass}.
   */
  handleError<Cs extends [ErrorClass, ...ErrorClass[]], R extends ResultLike>(
    ...args: [
      ...errorClasses: HandleableClasses<E, Cs>,
      handler: (error: MatchedBy<E, Cs[number]>) => R,
    ]
  ): Chain<R, T, UnmatchedBy<E, Cs[number]>> {
    const handler = args[args.length - 1] as (error: unknown) => R;
    const classes = args.slice(0, -1) as unknown as Cs;
    if (this._isOk || !classes.some((c) => this._error instanceof c)) {
      return skip(this, handler);
    }
    const produced = handler(this._error);
    return (liftAsync(produced) ?? produced) as never;
  }
}

/**
 * A promise of a {@link Result}, with the same chaining surface.
 *
 * Not exported: you never construct one directly. A chain becomes an
 * `AsyncResult` the moment one of its callbacks returns a promise, and every
 * method on it returns another one, so a whole asynchronous pipeline reads as
 * one flat chain with no intermediate `await`.
 *
 * Its surface is deliberately a **subset** of `Result`'s: the chaining methods,
 * plus `getResult()`. Nothing reads a value — no accessors, no `match()`, no
 * `unwrap*()` — because until the chain settles there is nothing to read.
 * `getResult()` is the single way out, and from the `Result` it hands back you
 * get the whole synchronous surface.
 *
 * That subset relationship is what makes a short-circuited step safe: a
 * synchronous `Result` carries every member this class does, with the same
 * signature, so it can stand in for one without any caller noticing.
 *
 * Deliberately **not** thenable — `await chain` does nothing useful.
 */
export class AsyncResult<T, E> {
  private constructor(private readonly promise: Promise<Result<T, E>>) {}

  /** Wraps a `Promise<Result<T, E>>`. Internal — the chain calls this for you. */
  static from<T, E>(promise: Promise<Result<T, E>>): AsyncResult<T, E> {
    return new AsyncResult(promise);
  }

  // ── resolution ────────────────────────────────────────────────────────

  /**
   * Resolves the chain to a plain {@link Result}. The way every asynchronous
   * chain ends.
   */
  getResult(): Promise<Result<T, E>> {
    return this.promise;
  }

  // ── transformation ────────────────────────────────────────────────────

  /** Runs a side effect on the success value; awaited if it returns a promise. */
  tap(fn: (value: T) => void | Promise<void>): AsyncResult<T, E> {
    return new AsyncResult(
      this.promise.then(async (r) => {
        if (r.isOk) await fn(r.value as T);
        return r;
      }),
    );
  }

  /** Runs a side effect on the error; awaited if it returns a promise. */
  tapError(fn: (error: E) => void | Promise<void>): AsyncResult<T, E> {
    return new AsyncResult(
      this.promise.then(async (r) => {
        if (!r.isOk) await fn(r.error as E);
        return r;
      }),
    );
  }

  /**
   * Runs `fn` on the success value; passes a failure through untouched.
   * `fn` may return a result, a promise of one, or another `AsyncResult`.
   */
  mapValue<R extends ResultLike>(fn: (value: T) => R): AsyncResult<InferOk<R>, E | InferErr<R>> {
    return new AsyncResult(
      this.promise.then((r) => (r.isOk ? (settle(fn(r.value as T)) as never) : (r as never))),
    ) as never;
  }

  /** Runs `fn` on the error; passes a success through untouched. */
  mapError<R extends ResultLike>(fn: (error: E) => R): AsyncResult<T | InferOk<R>, InferErr<R>> {
    return new AsyncResult(
      this.promise.then((r) => (r.isOk ? (r as never) : (settle(fn(r.error as E)) as never))),
    ) as never;
  }

  /**
   * Handles one or more specific error classes and removes exactly those from
   * the error union. The handler may be synchronous or asynchronous.
   *
   * As on {@link Result.handleError}, naming a class that is not in the union
   * is a compile error.
   */
  handleError<Cs extends [ErrorClass, ...ErrorClass[]], R extends ResultLike>(
    ...args: [
      ...errorClasses: HandleableClasses<E, Cs>,
      handler: (error: MatchedBy<E, Cs[number]>) => R,
    ]
  ): AsyncResult<T | InferOk<R>, UnmatchedBy<E, Cs[number]> | InferErr<R>> {
    const handler = args[args.length - 1] as (error: unknown) => R;
    const classes = args.slice(0, -1) as unknown as Cs;
    return new AsyncResult(
      this.promise.then((r) =>
        !r.isOk && classes.some((c) => r.error instanceof c)
          ? (settle(handler(r.error)) as never)
          : (r as never),
      ),
    ) as never;
  }
}

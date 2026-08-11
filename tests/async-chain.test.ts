/**
 * The asynchronous half of a chain.
 *
 * `AsyncResult` is not exported, so everything here reaches it the way a user
 * would: through `toAsync()`, or by handing a chain an asynchronous callback.
 *
 * It is deliberately not thenable, so a chain is always finished with
 * `getResult()` or with a terminal — never with a bare `await chain`.
 */
import { describe, expect, it, vi } from "vitest";
import { Result, ResultUnwrapError } from "../src";
import { NotFoundError, ParseError, TimeoutError, TooSmallError, tick } from "./helpers";

/** An async chain carrying a value. */
const asyncOk = <T>(value: T) => Result.ok(value).toAsync();

describe("mapValue on an async chain", () => {
  it("accepts a synchronous callback", async () => {
    const r = await asyncOk(2)
      .mapValue((n) => Result.ok(n * 3))
      .getResult();
    expect(r.value).toBe(6);
  });

  it("accepts an asynchronous callback", async () => {
    const r = await asyncOk(2)
      .mapValue(async (n) => {
        await tick();
        return Result.ok(n * 3);
      })
      .getResult();
    expect(r.value).toBe(6);
  });

  it("unwraps a callback that returns another async chain", async () => {
    // Without explicit unwrapping this would resolve to the AsyncResult object
    // itself, because AsyncResult is not thenable.
    const double = Result.registerExecution(async (n: number) => Result.ok(n * 2));
    const r = await asyncOk(4)
      .mapValue((n) => double(n))
      .getResult();
    expect(r).toBeInstanceOf(Result);
    expect(r.value).toBe(8);
  });

  it("short-circuits on a failure", async () => {
    const fn = vi.fn(async () => Result.ok(1));
    const err = new NotFoundError("u1");
    const r = await Result.err(err).toAsync().mapValue(fn).getResult();
    expect(fn).not.toHaveBeenCalled();
    expect(r.error).toBe(err);
  });

  it("runs a long chain in order", async () => {
    const order: string[] = [];
    const r = await asyncOk(1)
      .mapValue(async (n) => {
        order.push("a");
        await tick(5);
        return Result.ok(n + 1);
      })
      .mapValue((n) => {
        order.push("b");
        return Result.ok(n * 10);
      })
      .mapValue(async (n) => {
        order.push("c");
        return Result.ok(`#${n}`);
      })
      .getResult();

    expect(order).toEqual(["a", "b", "c"]);
    expect(r.value).toBe("#20");
  });
});

describe("mapError on an async chain", () => {
  it("recovers from a failure", async () => {
    const r = await Result.err(new ParseError())
      .toAsync()
      .mapError(async () => Result.ok("recovered"))
      .getResult();
    expect(r.value).toBe("recovered");
  });

  it("can replace one error with another", async () => {
    const r = await Result.err(new ParseError())
      .toAsync()
      .mapError(() => Result.err(new TimeoutError()))
      .getResult();
    expect(r.error).toBeInstanceOf(TimeoutError);
  });

  it("unwraps a callback that returns another async chain", async () => {
    const recover = Result.registerExecution(async () => Result.ok("from chain"));
    const r = await Result.err(new ParseError())
      .toAsync()
      .mapError(() => recover())
      .getResult();
    expect(r).toBeInstanceOf(Result);
    expect(r.value).toBe("from chain");
  });

  it("passes a success through without calling the callback", async () => {
    const fn = vi.fn(() => Result.ok(0));
    const r = await asyncOk(9).mapError(fn).getResult();
    expect(fn).not.toHaveBeenCalled();
    expect(r.value).toBe(9);
  });
});

describe("handleError on an async chain", () => {
  it("handles a matching class with a sync handler", async () => {
    const r = await Result.err(new TooSmallError(4))
      .toAsync()
      .handleError(TooSmallError, (e) => Result.ok(e.limit))
      .getResult();
    expect(r.value).toBe(4);
  });

  it("handles a matching class with an async handler", async () => {
    const r = await Result.err(new TooSmallError(4))
      .toAsync()
      .handleError(TooSmallError, async (e) => {
        await tick();
        return Result.ok(e.limit * 2);
      })
      .getResult();
    expect(r.value).toBe(8);
  });

  it("unwraps a handler that returns another async chain", async () => {
    const recover = Result.registerExecution(async () => Result.ok("from chain"));
    const r = await Result.err(new TooSmallError(1))
      .toAsync()
      .handleError(TooSmallError, () => recover())
      .getResult();
    expect(r).toBeInstanceOf(Result);
    expect(r.value).toBe("from chain");
  });

  it("handles several classes at once", async () => {
    const source: Result<never, TimeoutError | ParseError> = Result.err(new TimeoutError());
    const r = await source
      .toAsync()
      .handleError(TimeoutError, ParseError, (e) => Result.ok(`handled ${e._tag}`))
      .getResult();
    expect(r.value).toBe("handled TimeoutError");
  });

  it("leaves a non-matching error alone", async () => {
    const err = new ParseError();
    const handler = vi.fn(() => Result.ok(0));
    // @ts-expect-error TimeoutError is not in the union
    const r = await Result.err(err).toAsync().handleError(TimeoutError, handler).getResult();
    expect(handler).not.toHaveBeenCalled();
    expect(r.error).toBe(err);
  });

  it("does not run on a success", async () => {
    const handler = vi.fn(() => Result.ok(0));
    // @ts-expect-error an ok chain has no errors left to handle
    const r = await asyncOk("original").handleError(TimeoutError, handler).getResult();
    expect(handler).not.toHaveBeenCalled();
    expect(r.value).toBe("original");
  });

  it("peels errors off the union one handler at a time", async () => {
    const load = Result.registerExecution(async (kind: string) => {
      if (kind === "missing") return Result.err(new NotFoundError(kind));
      if (kind === "slow") return Result.err(new TimeoutError());
      return Result.ok("fine");
    });

    const run = async (kind: string) =>
      (
        await load(kind)
          .handleError(NotFoundError, () => Result.ok("absent"))
          .handleError(TimeoutError, () => Result.ok("timed out"))
          .getResult()
      ).unwrap();

    expect(await run("missing")).toBe("absent");
    expect(await run("slow")).toBe("timed out");
    expect(await run("ok")).toBe("fine");
  });
});

describe("tap / tapError on an async chain", () => {
  it("observes the value and awaits an async effect", async () => {
    const seen: number[] = [];
    const r = await asyncOk(3)
      .tap(async (n) => {
        await tick(5);
        seen.push(n);
      })
      .getResult();
    expect(seen).toEqual([3]);
    expect(r.value).toBe(3);
  });

  it("observes the value with a sync effect", async () => {
    const seen: number[] = [];
    const r = await asyncOk(3)
      .tap((n) => {
        seen.push(n);
      })
      .getResult();
    expect(seen).toEqual([3]);
    expect(r.value).toBe(3);
  });

  it("skips tap on a failure and runs tapError instead", async () => {
    const onOk = vi.fn();
    const onErr = vi.fn();
    const err = new ParseError();
    const r = await Result.err(err).toAsync().tap(onOk).tapError(onErr).getResult();
    expect(onOk).not.toHaveBeenCalled();
    expect(onErr).toHaveBeenCalledWith(err);
    expect(r.error).toBe(err);
  });

  it("skips tapError on a success", async () => {
    const onErr = vi.fn();
    const r = await asyncOk(1).tapError(onErr).getResult();
    expect(onErr).not.toHaveBeenCalled();
    expect(r.value).toBe(1);
  });

  it("awaits an async tapError before continuing", async () => {
    const seen: string[] = [];
    await Result.err(new ParseError())
      .toAsync()
      .tapError(async (e) => {
        await tick(5);
        seen.push(e._tag);
      })
      .getResult();
    expect(seen).toEqual(["ParseError"]);
  });
});

describe("resolving an async chain", () => {
  it("getResult() is the only way out, and the Result carries the terminals", async () => {
    const settled = await asyncOk(1).getResult();
    expect(settled).toBeInstanceOf(Result);
    expect(settled.match({ ok: (n) => `ok:${n}`, err: () => "err" })).toBe("ok:1");
    expect(settled.unwrap()).toBe(1);
    expect(settled.unwrapOr(0)).toBe(1);
    expect(settled.value).toBe(1);
    expect(settled.isOk).toBe(true);
  });

  it("carries a failure through to the Result's terminals", async () => {
    const err = new ParseError();
    const settled = await Result.err(err).toAsync().getResult();
    expect(settled.unwrapOr(0)).toBe(0);
    expect(settled.unwrapError()).toBe(err);
    expect(() => settled.unwrap()).toThrow(ResultUnwrapError);
    expect(settled.match({ ok: () => "ok", err: (e) => e._tag })).toBe("ParseError");
  });

  it("exposes no terminals of its own", () => {
    const chain = asyncOk(1) as unknown as Record<string, unknown>;
    for (const name of ["match", "unwrap", "unwrapError", "unwrapOr", "unwrapOrElse"]) {
      expect(chain[name]).toBeUndefined();
    }
  });

  it("exposes no synchronous accessors either", () => {
    const chain = asyncOk(1) as unknown as Record<string, unknown>;
    for (const name of ["value", "error", "isOk", "isErr", "toAsync"]) {
      expect(chain[name]).toBeUndefined();
    }
  });

  it("is not thenable — awaiting the chain itself does not resolve it", async () => {
    const chain = asyncOk(1);
    expect((chain as { then?: unknown }).then).toBeUndefined();
    expect(await (chain as unknown as Promise<unknown>)).toBe(chain);
  });

  it("propagates a rejection of the underlying promise", async () => {
    const boom = new Error("boom");
    const chain = Result.registerExecution(async () => {
      throw boom;
    })();
    await expect(chain.getResult()).rejects.toBe(boom);
  });
});

describe("an end-to-end pipeline", () => {
  class EmptyNameError extends ParseError {}

  const fetchUser = Result.registerExecution(async (id: string) => {
    await tick();
    if (id === "") return Result.err(new ParseError(id));
    if (id === "missing") return Result.err(new NotFoundError(id));
    return Result.ok({ id, name: "Ada" });
  });

  const loadDisplayName = Result.registerExecution(async (id: string) =>
    fetchUser(id)
      .mapValue((u) => (u.name.length > 0 ? Result.ok(u.name) : Result.err(new EmptyNameError())))
      .mapValue(async (name) => {
        await tick();
        return Result.ok(name.toUpperCase());
      })
      .getResult(),
  );

  it("runs the happy path", async () => {
    expect((await loadDisplayName("u1").getResult()).unwrap()).toBe("ADA");
  });

  it("surfaces a domain error and lets the caller retire it", async () => {
    const settled = await loadDisplayName("missing")
      .handleError(NotFoundError, () => Result.ok("anonymous"))
      .handleError(ParseError, () => Result.ok("invalid"))
      .getResult();
    expect(settled.unwrap()).toBe("anonymous");
  });

  it("stays typed all the way through Result.all", async () => {
    const r = await Result.all([loadDisplayName("u1"), loadDisplayName("u2")]).getResult();
    expect(r.value).toEqual(["ADA", "ADA"]);
  });
});

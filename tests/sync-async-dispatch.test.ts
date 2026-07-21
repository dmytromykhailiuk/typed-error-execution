/**
 * The unified methods: one `mapValue` / `mapError` / `handleError` / `tap` /
 * `try` / `all` / `registerExecution` that decides at runtime, from what the
 * callback actually produced, whether the chain stays synchronous or becomes
 * asynchronous.
 */
import { describe, expect, it, vi } from "vitest";
import { Result } from "../src";
import { NotFoundError, ParseError, TimeoutError, TooSmallError, tick } from "./helpers";

/** A promise-returning function that is not declared `async`. */
const promised = <T>(value: T) => Promise.resolve(value);

describe("mapValue dispatch", () => {
  it("stays synchronous for a synchronous callback", () => {
    const out = Result.ok(2).mapValue((n) => Result.ok(n * 2));
    expect(out).toBeInstanceOf(Result);
    expect(out.value).toBe(4);
  });

  it("becomes asynchronous for an async callback", async () => {
    const out = Result.ok(2).mapValue(async (n) => Result.ok(n * 2));
    expect(out).not.toBeInstanceOf(Result);
    expect((await out.getResult()).value).toBe(4);
  });

  it("becomes asynchronous for a non-async function returning a promise", async () => {
    const out = Result.ok(2).mapValue((n) => promised(Result.ok(n * 2)));
    expect(out).not.toBeInstanceOf(Result);
    expect((await out.getResult()).value).toBe(4);
  });

  it("becomes asynchronous when the callback returns another AsyncResult", async () => {
    const double = Result.registerExecution(async (n: number) => Result.ok(n * 2));
    const out = Result.ok(2).mapValue((n) => double(n));
    expect(out).not.toBeInstanceOf(Result);
    expect((await out.getResult()).value).toBe(4);
  });

  it("keeps going asynchronously once the chain has turned", async () => {
    const out = Result.ok(1)
      .mapValue(async (n) => Result.ok(n + 1))
      .mapValue((n) => Result.ok(n * 10)) // sync callback on an async chain
      .mapValue(async (n) => Result.ok(`#${n}`));
    expect((await out.getResult()).value).toBe("#20");
  });
});

describe("mapError dispatch", () => {
  it("stays synchronous for a synchronous callback", () => {
    const out = Result.err(new ParseError()).mapError(() => Result.ok("recovered"));
    expect(out).toBeInstanceOf(Result);
    expect(out.value).toBe("recovered");
  });

  it("becomes asynchronous for an async callback", async () => {
    const out = Result.err(new ParseError()).mapError(async () => Result.ok("recovered"));
    expect(out).not.toBeInstanceOf(Result);
    expect((await out.getResult()).value).toBe("recovered");
  });
});

describe("handleError dispatch", () => {
  it("stays synchronous for a synchronous handler", () => {
    const out = Result.err(new TooSmallError(4)).handleError(TooSmallError, (e) =>
      Result.ok(e.limit),
    );
    expect(out).toBeInstanceOf(Result);
    expect(out.value).toBe(4);
  });

  it("becomes asynchronous for an async handler", async () => {
    const out = Result.err(new TooSmallError(4)).handleError(TooSmallError, async (e) => {
      await tick();
      return Result.ok(e.limit * 2);
    });
    expect(out).not.toBeInstanceOf(Result);
    expect((await out.getResult()).value).toBe(8);
  });
});

describe("tap dispatch", () => {
  it("stays synchronous for a synchronous effect", () => {
    const seen: number[] = [];
    const out = Result.ok(3).tap((n) => {
      seen.push(n);
    });
    expect(out).toBeInstanceOf(Result);
    expect(seen).toEqual([3]);
  });

  it("becomes asynchronous for an async effect, and waits for it", async () => {
    const seen: number[] = [];
    const out = Result.ok(3).tap(async (n) => {
      await tick(10);
      seen.push(n);
    });
    expect(out).not.toBeInstanceOf(Result);
    // Not yet — the effect is still pending.
    expect(seen).toEqual([]);
    const settled = await out.getResult();
    expect(seen).toEqual([3]);
    expect(settled.value).toBe(3);
  });

  it("tapError becomes asynchronous for an async effect and waits for it", async () => {
    const seen: string[] = [];
    const err = new ParseError("{");
    const out = Result.err(err).tapError(async (e) => {
      await tick(10);
      seen.push(e._tag);
    });
    expect(seen).toEqual([]);
    expect((await out.getResult()).error).toBe(err);
    expect(seen).toEqual(["ParseError"]);
  });
});

describe("Result.try dispatch", () => {
  it("stays synchronous for a synchronous body", () => {
    const out = Result.try(
      () => JSON.parse('{"a":1}') as { a: number },
      () => new ParseError(),
    );
    expect(out).toBeInstanceOf(Result);
    expect(out.value).toEqual({ a: 1 });
  });

  it("becomes asynchronous for a promise-returning body", async () => {
    const out = Result.try(
      async () => 42,
      () => new ParseError(),
    );
    expect(out).not.toBeInstanceOf(Result);
    expect((await out.getResult()).value).toBe(42);
  });

  it("converts a rejection into a tagged error", async () => {
    const out = Result.try(
      async () => {
        await tick();
        throw new Error("network down");
      },
      (thrown) => new ParseError(String(thrown)),
    );
    expect((await out.getResult()).error).toBeInstanceOf(ParseError);
    expect((await out.getResult()).error?.raw).toContain("network down");
  });

  it("converts a synchronous throw from a promise-returning function", async () => {
    const out = Result.try(
      (() => {
        throw new Error("immediate");
      }) as () => Promise<number>,
      () => new ParseError("immediate"),
    );
    // It threw before returning a promise, so there was no promise to wrap.
    // The stand-in contract keeps this usable either way.
    expect((await out.getResult()).error).toBeInstanceOf(ParseError);
    expect((await out.getResult()).error).toBeInstanceOf(ParseError);
  });

  it("wraps a non-promise value even when the body is not async", () => {
    const out = Result.try(
      () => 1,
      () => new ParseError(),
    );
    expect(out.value).toBe(1);
  });
});

describe("registerExecution dispatch", () => {
  it("returns a Result for a synchronous body", () => {
    const fn = Result.registerExecution((n: number) =>
      n > 0 ? Result.ok(n) : Result.err(new TooSmallError(0)),
    );
    expect(fn(1)).toBeInstanceOf(Result);
    expect(fn(1).value).toBe(1);
    expect(fn(-1).error).toBeInstanceOf(TooSmallError);
  });

  it("returns an AsyncResult for an async body", async () => {
    const fn = Result.registerExecution(async (id: string) =>
      id === "missing" ? Result.err(new NotFoundError(id)) : Result.ok({ id }),
    );
    expect(fn("u1")).not.toBeInstanceOf(Result);
    expect((await fn("u1").getResult()).value).toEqual({ id: "u1" });
    expect((await fn("missing").getResult()).error).toBeInstanceOf(NotFoundError);
  });

  it("forwards every argument", () => {
    const spy = vi.fn((_a: number, _b: string, _c: boolean) => Result.ok("done"));
    Result.registerExecution(spy)(1, "two", true);
    expect(spy).toHaveBeenCalledWith(1, "two", true);
  });

  it("calls the underlying function once per invocation", async () => {
    const spy = vi.fn(async (n: number) => Result.ok(n));
    const fn = Result.registerExecution(spy);
    await fn(1).getResult();
    await fn(2).getResult();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("lets an exception from a sync body escape — it does not swallow throws", () => {
    const boom = Result.registerExecution(() => {
      throw new Error("boom");
    });
    expect(() => boom()).toThrow("boom");
  });

  it("rejects rather than swallowing a throw from an async body", async () => {
    const boom = Result.registerExecution(async () => {
      throw new Error("boom");
    });
    await expect(boom().getResult()).rejects.toThrow("boom");
  });
});

describe("Result.all dispatch", () => {
  it("stays synchronous when every member is synchronous", () => {
    const out = Result.all([Result.ok(1), Result.ok("two")]);
    expect(out).toBeInstanceOf(Result);
    expect(out.value).toEqual([1, "two"]);
  });

  it("becomes asynchronous when any member is asynchronous", async () => {
    const out = Result.all([Result.ok(1), Result.ok(2).toAsync()]);
    expect(out).not.toBeInstanceOf(Result);
    expect((await out.getResult()).value).toEqual([1, 2]);
  });

  it("accepts a bare promise of a result", async () => {
    const out = Result.all([Result.ok(1), Promise.resolve(Result.ok(2))]);
    expect((await out.getResult()).value).toEqual([1, 2]);
  });

  it("reports the first error in argument order, not the fastest", async () => {
    const slowFirst = Result.try(
      async () => {
        await tick(20);
        throw new Error("slow");
      },
      () => new ParseError("slow"),
    );
    const fastSecond = Result.try(
      async () => {
        await tick(1);
        throw new Error("fast");
      },
      () => new NotFoundError("fast"),
    );

    const out = await Result.all([slowFirst, fastSecond]).getResult();
    expect(out.error).toBeInstanceOf(ParseError);
  });

  it("runs asynchronous members concurrently", async () => {
    // Counting overlap is deterministic; wall-clock thresholds are not, and
    // flake under coverage instrumentation on a loaded machine.
    let inFlight = 0;
    let peak = 0;
    const make = (id: number) =>
      Result.try(
        async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await tick(10);
          inFlight -= 1;
          return id;
        },
        () => new TimeoutError(),
      );

    const out = await Result.all([make(1), make(2), make(3)]).getResult();
    expect(out.value).toEqual([1, 2, 3]);
    expect(peak).toBe(3); // all three overlapped; sequential would peak at 1
  });

  it("handles an empty list synchronously", () => {
    const out = Result.all([]);
    expect(out).toBeInstanceOf(Result);
    expect(out.value).toEqual([]);
  });
});

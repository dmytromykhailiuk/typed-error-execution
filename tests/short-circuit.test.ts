/**
 * What a **skipped** step hands back.
 *
 * `Result.err(e).mapValue(fn)` never calls `fn`, so there is no returned value
 * to inspect — yet the step's inferred type is asynchronous exactly when `fn`
 * is. Two rules close that gap:
 *
 *   1. `fn` declared `async` is detectable on the function object, so the chain
 *      becomes a real `AsyncResult` and the type is exactly right.
 *   2. Anything else is assumed synchronous. A plain function that returns a
 *      promise therefore still yields a `Result` where the type says chain —
 *      safe, because a `Result` stands in for a chain, but not the reverse.
 *
 * These tests pin both rules down.
 */
import { describe, expect, it, vi } from "vitest";
import { Result, ResultUnwrapError } from "../src";
import { NotFoundError, ParseError, TimeoutError, tick } from "./helpers";

describe("an async callback upgrades a skipped step to a real chain", () => {
  const err = new ParseError("{");

  it("mapValue on a failure", async () => {
    const chain = Result.err(err).mapValue(async (n: number) => Result.ok(n + 1));
    expect(chain).not.toBeInstanceOf(Result);
    expect((await chain.getResult()).error).toBe(err);
  });

  it("mapError on a success", async () => {
    const chain = Result.ok(7).mapError(async () => Result.ok(0));
    expect(chain).not.toBeInstanceOf(Result);
    expect((await chain.getResult()).value).toBe(7);
  });

  it("handleError with no matching class", async () => {
    // @ts-expect-error TimeoutError is not in the union — the runtime still skips
    const chain = Result.err(err).handleError(TimeoutError, async () => Result.ok(0));
    expect(chain).not.toBeInstanceOf(Result);
    expect((await chain.getResult()).error).toBe(err);
  });

  it("handleError on a success", async () => {
    // @ts-expect-error an ok Result has no errors left to handle
    const chain = Result.ok("original").handleError(TimeoutError, async () => Result.ok("x"));
    expect(chain).not.toBeInstanceOf(Result);
    expect((await chain.getResult()).value).toBe("original");
  });

  it("tap on a failure", async () => {
    let ran = false;
    const chain = Result.err(err).tap(async () => {
      ran = true;
    });
    expect(chain).not.toBeInstanceOf(Result);
    expect(ran).toBe(false);
    expect((await chain.getResult()).error).toBe(err);
  });

  it("tapError on a success", async () => {
    let ran = false;
    const chain = Result.ok(5).tapError(async () => {
      ran = true;
    });
    expect(chain).not.toBeInstanceOf(Result);
    expect(ran).toBe(false);
    expect((await chain.getResult()).value).toBe(5);
  });

  it("never calls the callback it was handed", () => {
    const fn = vi.fn(async () => Result.ok(1));
    Result.err(err).mapValue(fn);
    expect(fn).not.toHaveBeenCalled();
  });

  it("detects every async form, not just arrows", async () => {
    const decl = async function step(n: number) {
      return Result.ok(n);
    };
    const method = {
      async step(n: number) {
        return Result.ok(n);
      },
    }.step;

    expect(Result.err(err).mapValue(decl)).not.toBeInstanceOf(Result);
    expect(Result.err(err).mapValue(method)).not.toBeInstanceOf(Result);
    expect(Result.err(err).mapValue(decl.bind(null))).not.toBeInstanceOf(Result);
  });

  it("keeps a synchronous callback synchronous", () => {
    const chain = Result.err(err).mapValue((n: number) => Result.ok(n + 1));
    expect(chain).toBeInstanceOf(Result);
    expect(chain.error).toBe(err); // readable immediately, no await
  });
});

describe("the residual case: a plain function that returns a promise", () => {
  const err = new ParseError("{");
  // Not declared `async`, so it cannot be detected without calling it. The
  // chain stays a Result; the type says asynchronous. Everything still works
  // because a Result is a complete stand-in for a chain.
  const chain = () => Result.err(err).mapValue((n: number) => Promise.resolve(Result.ok(n + 1)));

  it("also covers a wrapped async function, which is a plain function again", () => {
    // vi.fn(async …) — and any decorator, memoiser or spy — hands back an
    // ordinary function, so the `async` marker is gone.
    const wrapped = vi.fn(async (n: number) => Result.ok(n));
    expect(Result.err(err).mapValue(wrapped)).toBeInstanceOf(Result);
  });

  it("stays the synchronous class", () => {
    expect(chain()).toBeInstanceOf(Result);
  });

  it("supports getResult()", async () => {
    const settled = await chain().getResult();
    expect(settled).toBeInstanceOf(Result);
    expect(settled.error).toBe(err);
  });

  it("supports every member the async type permits, via getResult()", async () => {
    const settled = await chain().getResult();
    expect(settled.match({ ok: () => "ok", err: (e) => `err:${e._tag}` })).toBe("err:ParseError");
    expect(settled.unwrapOr(-1)).toBe(-1);
    expect(settled.unwrapOrElse((e) => e._tag)).toBe("ParseError");
    expect(settled.unwrapError()).toBe(err);
    expect(() => settled.unwrap()).toThrow(ResultUnwrapError);
  });

  it("keeps chaining, and turns async for real when a callback runs", async () => {
    const out = chain()
      .mapValue(async (n) => Result.ok(n * 2))
      .handleError(ParseError, async () => Result.ok(99));

    expect(out).not.toBeInstanceOf(Result);
    expect((await out.getResult()).value).toBe(99);
  });

  it("can be collected by Result.all alongside genuinely async members", async () => {
    const out = await Result.all([chain(), Result.ok("sync"), Result.ok(1).toAsync()]).getResult();
    expect(out.error).toBe(err);
  });
});

describe("getResult() on a plain Result", () => {
  // The one bridge, present on both classes with the same signature — which is
  // what lets a Result stand in for a chain.
  it("resolves to the result itself", async () => {
    const r = Result.ok(1);
    expect(await r.getResult()).toBe(r);
  });

  it("works on a failure too", async () => {
    const r = Result.err(new ParseError());
    expect(await r.getResult()).toBe(r);
  });
});

describe("the subset invariant", () => {
  // Every member an async chain exposes must exist on Result, or a
  // short-circuited step would break the moment a caller used it.
  it("AsyncResult's surface is a subset of Result's", () => {
    const members = (o: object) =>
      new Set(
        Object.getOwnPropertyNames(Object.getPrototypeOf(o)).filter((n) => n !== "constructor"),
      );

    const asyncMembers = members(Result.ok(1).toAsync());
    const syncMembers = members(Result.ok(1));
    const missing = [...asyncMembers].filter((m) => !syncMembers.has(m));

    expect(missing).toEqual([]);
    expect(asyncMembers.size).toBeGreaterThan(0);
  });
});

describe("toAsync", () => {
  it("forces a synchronous result into an asynchronous chain", async () => {
    const chain = Result.ok(1).toAsync();
    expect(chain).not.toBeInstanceOf(Result);
    expect((await chain.mapValue((n) => Result.ok(n + 1)).getResult()).value).toBe(2);
  });

  it("carries a failure across", async () => {
    const err = new NotFoundError("u1");
    expect((await Result.err(err).toAsync().getResult()).error).toBe(err);
  });

  it("awaits an async effect that a skipped step upgraded", async () => {
    const seen: string[] = [];
    const out = await Result.ok(1)
      .tap(async () => {
        await tick(5);
        seen.push("ran");
      })
      .getResult();
    expect(seen).toEqual(["ran"]);
    expect(out.value).toBe(1);
  });
});

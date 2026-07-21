import { describe, expect, it, vi } from "vitest";
import { Result, ResultUnwrapError } from "../src";
import { NotFoundError, ParseError } from "./helpers";

describe("Result.ok", () => {
  it("carries the value", () => {
    const r = Result.ok(42);
    expect(r.isOk).toBe(true);
    expect(r.isErr).toBe(false);
    expect(r.value).toBe(42);
    expect(r.error).toBeUndefined();
  });

  it("supports a void success", () => {
    const r = Result.ok();
    expect(r.isOk).toBe(true);
    expect(r.value).toBeUndefined();
  });

  it("treats an explicit undefined as a value, not as a failure", () => {
    const r = Result.ok(undefined);
    expect(r.isOk).toBe(true);
    expect(r.value).toBeUndefined();
  });

  it("does not unwrap a nested Result", () => {
    const inner = Result.ok(1);
    const outer = Result.ok(inner);
    expect(outer.value).toBe(inner);
  });
});

describe("Result.empty", () => {
  it("is an ok carrying null", () => {
    const r = Result.empty();
    expect(r.isOk).toBe(true);
    expect(r.value).toBeNull();
  });
});

describe("Result.err", () => {
  it("carries the tagged error", () => {
    const err = new NotFoundError("u1");
    const r = Result.err(err);
    expect(r.isOk).toBe(false);
    expect(r.isErr).toBe(true);
    expect(r.error).toBe(err);
    expect(r.value).toBeUndefined();
  });
});

describe("match", () => {
  it("runs the ok branch on a success", () => {
    const label = Result.ok(2).match({ ok: (n) => `ok:${n}`, err: () => "err" });
    expect(label).toBe("ok:2");
  });

  it("runs the err branch on a failure", () => {
    const label = Result.err(new NotFoundError("u1")).match({
      ok: () => "ok",
      err: (e) => `err:${e._tag}:${e.id}`,
    });
    expect(label).toBe("err:NotFoundError:u1");
  });

  it("runs exactly one branch", () => {
    const ok = vi.fn(() => 1);
    const err = vi.fn(() => 2);
    Result.ok("x").match({ ok, err });
    expect(ok).toHaveBeenCalledTimes(1);
    expect(err).not.toHaveBeenCalled();
  });
});

describe("unwrap", () => {
  it("returns the value on a success", () => {
    expect(Result.ok(7).unwrap()).toBe(7);
  });

  it("throws ResultUnwrapError on a failure and keeps the original error", () => {
    const err = new NotFoundError("u1");
    try {
      Result.err(err).unwrap();
      expect.unreachable("unwrap() should have thrown");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(ResultUnwrapError);
      expect((thrown as ResultUnwrapError).taggedError).toBe(err);
      expect((thrown as ResultUnwrapError).message).toContain("NotFoundError");
    }
  });
});

describe("unwrap — error descriptions", () => {
  it("names a tagged error by its tag", () => {
    expect(() => Result.err(new ParseError("{")).unwrap()).toThrow(/ParseError/);
  });

  it("degrades gracefully if something force-cast past the literal-tag guard", () => {
    // Not reachable through the public API — `err()` demands a tagged error —
    // but the message must not blow up if someone casts their way in.
    expect(() => Result.err("not tagged" as never).unwrap()).toThrow(/not tagged/);
    // An object without a string `_tag` is not a tagged error either.
    expect(() => Result.err({} as never).unwrap()).toThrow(/\[object Object\]/);
  });
});

describe("unwrapError", () => {
  it("returns the error on a failure", () => {
    const err = new ParseError("{");
    expect(Result.err(err).unwrapError()).toBe(err);
  });

  it("throws on a success", () => {
    expect(() => Result.ok(1).unwrapError()).toThrow(ResultUnwrapError);
  });
});

describe("unwrapOr / unwrapOrElse", () => {
  it("returns the value when ok", () => {
    expect(Result.ok(1).unwrapOr(0)).toBe(1);
    expect(Result.ok(1).unwrapOrElse(() => 0)).toBe(1);
  });

  it("returns the fallback when err", () => {
    expect(Result.err(new ParseError()).unwrapOr(0)).toBe(0);
  });

  it("computes the fallback from the error", () => {
    const out = Result.err(new NotFoundError("u9")).unwrapOrElse((e) => e.id);
    expect(out).toBe("u9");
  });

  it("does not call the fallback factory when ok", () => {
    const fallback = vi.fn(() => 0);
    Result.ok(1).unwrapOrElse(fallback);
    expect(fallback).not.toHaveBeenCalled();
  });
});

describe("tap / tapError", () => {
  it("observes the value and passes the result through unchanged", () => {
    const seen: number[] = [];
    const r = Result.ok(3);
    const out = r.tap((n) => {
      seen.push(n);
    });
    expect(seen).toEqual([3]);
    expect(out).toBe(r);
  });

  it("does not run tap on a failure", () => {
    const spy = vi.fn();
    Result.err(new ParseError()).tap(spy);
    expect(spy).not.toHaveBeenCalled();
  });

  it("observes the error and passes the result through unchanged", () => {
    const spy = vi.fn();
    const r = Result.err(new ParseError("{"));
    expect(r.tapError(spy)).toBe(r);
    expect(spy).toHaveBeenCalledWith(r.error);
  });

  it("does not run tapError on a success", () => {
    const spy = vi.fn();
    Result.ok(1).tapError(spy);
    expect(spy).not.toHaveBeenCalled();
  });
});

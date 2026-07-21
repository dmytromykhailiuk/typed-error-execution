import { describe, expect, it, vi } from "vitest";
import { Result } from "../src";
import { NotFoundError, ParseError, TooSmallError } from "./helpers";

describe("mapValue", () => {
  it("transforms the success value", () => {
    const out = Result.ok(2).mapValue((n) => Result.ok(n * 2));
    expect(out.value).toBe(4);
  });

  it("can introduce a new error", () => {
    const out = Result.ok("nope").mapValue((s) =>
      /^\d+$/.test(s) ? Result.ok(Number(s)) : Result.err(new ParseError(s)),
    );
    expect(out.isErr).toBe(true);
    expect(out.error).toBeInstanceOf(ParseError);
  });

  it("short-circuits on a failure without calling fn", () => {
    const fn = vi.fn(() => Result.ok(1));
    const err = new NotFoundError("u1");
    const out = Result.err(err).mapValue(fn);
    expect(fn).not.toHaveBeenCalled();
    expect(out.error).toBe(err);
  });

  it("chains left to right", () => {
    const out = Result.ok(1)
      .mapValue((n) => Result.ok(n + 1))
      .mapValue((n) => Result.ok(n * 10))
      .mapValue((n) => Result.ok(`#${n}`));
    expect(out.value).toBe("#20");
  });

  it("stops the chain at the first failure", () => {
    const later = vi.fn(() => Result.ok("unreachable"));
    const out = Result.ok(1)
      .mapValue(() => Result.err(new ParseError("boom")))
      .mapValue(later);
    expect(later).not.toHaveBeenCalled();
    expect(out.error).toBeInstanceOf(ParseError);
  });
});

describe("mapError", () => {
  it("transforms the error", () => {
    const out = Result.err(new ParseError("{")).mapError(() => Result.ok("recovered"));
    expect(out.isOk).toBe(true);
    expect(out.value).toBe("recovered");
  });

  it("can replace one error with another", () => {
    const out = Result.err(new ParseError("{")).mapError(() => Result.err(new TooSmallError(3)));
    expect(out.error).toBeInstanceOf(TooSmallError);
  });

  it("passes a success through without calling fn", () => {
    const fn = vi.fn(() => Result.ok(0));
    const r = Result.ok(9);
    const out = r.mapError(fn);
    expect(fn).not.toHaveBeenCalled();
    expect(out.value).toBe(9);
  });
});

describe("Result.all", () => {
  it("collects every value into a tuple", () => {
    const out = Result.all([Result.ok(1), Result.ok("two"), Result.ok(true)]);
    expect(out.isOk).toBe(true);
    expect(out.value).toEqual([1, "two", true]);
  });

  it("returns the first error in argument order", () => {
    const first = new ParseError("a");
    const second = new NotFoundError("b");
    const out = Result.all([Result.ok(1), Result.err(first), Result.err(second)]);
    expect(out.error).toBe(first);
  });

  it("handles an empty list as an ok empty tuple", () => {
    const out = Result.all([]);
    expect(out.isOk).toBe(true);
    expect(out.value).toEqual([]);
  });
});

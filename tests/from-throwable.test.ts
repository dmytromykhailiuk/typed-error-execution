/**
 * `Result.fromThrowable` is `Result.try` lifted: it converts a throwing
 * function once, and hands back a function you call as many times as you like.
 * These tests pin down that the wrapping is lazy, that arguments survive it,
 * and that the sync/async rule is the same one `try` follows.
 */
import { describe, expect, it, vi } from "vitest";
import { Result } from "../src";
import { ParseError, TimeoutError, tick } from "./helpers";

describe("Result.fromThrowable", () => {
  it("wraps without running the function", () => {
    const fn = vi.fn((n: number) => n * 2);
    const wrapped = Result.fromThrowable(fn, () => new ParseError());

    expect(fn).not.toHaveBeenCalled();
    expect(typeof wrapped).toBe("function");
    expect(wrapped(21).value).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("passes every argument through", () => {
    const wrapped = Result.fromThrowable(
      (a: number, b: string, c: boolean) => `${a}${b}${c}`,
      () => new ParseError(),
    );
    expect(wrapped(1, "x", true).value).toBe("1xtrue");
  });

  it("converts a throw into a tagged error", () => {
    const wrapped = Result.fromThrowable(
      (raw: string) => JSON.parse(raw) as { a: number },
      (thrown) => new ParseError(String(thrown)),
    );

    expect(wrapped('{"a":1}').value).toEqual({ a: 1 });

    const failed = wrapped("{");
    expect(failed.isErr).toBe(true);
    expect(failed.error).toBeInstanceOf(ParseError);
    expect(failed.error?.raw).toContain("JSON");
  });

  it("is reusable: each call is independent", () => {
    const wrapped = Result.fromThrowable(
      (n: number) => {
        if (n < 0) throw new Error("negative");
        return n;
      },
      () => new ParseError(),
    );

    expect(wrapped(1).value).toBe(1);
    expect(wrapped(-1).isErr).toBe(true);
    expect(wrapped(2).value).toBe(2);
  });

  it("becomes asynchronous for a promise-returning function", async () => {
    const wrapped = Result.fromThrowable(
      async (n: number) => {
        await tick();
        return n + 1;
      },
      () => new TimeoutError(),
    );

    const chain = wrapped(1);
    expect(chain).not.toBeInstanceOf(Result);
    expect((await chain.getResult()).value).toBe(2);
  });

  it("converts a rejection into a tagged error", async () => {
    const wrapped = Result.fromThrowable(
      async () => {
        await tick();
        throw new Error("network down");
      },
      (thrown) => new ParseError(String(thrown)),
    );

    const settled = await wrapped().getResult();
    expect(settled.error).toBeInstanceOf(ParseError);
    expect(settled.error?.raw).toContain("network down");
  });

  it("catches a synchronous throw from a promise-returning function", async () => {
    const wrapped = Result.fromThrowable(
      (() => {
        throw new Error("immediate");
      }) as () => Promise<number>,
      () => new ParseError("immediate"),
    );

    // Nothing was returned to inspect, so a plain Result comes back — safe,
    // because a Result stands in for a chain.
    expect((await wrapped().getResult()).error).toBeInstanceOf(ParseError);
  });

  it("produces a Result that chains like any other", () => {
    const parse = Result.fromThrowable(
      (raw: string) => JSON.parse(raw) as { a: number },
      () => new ParseError(),
    );

    const out = parse("{")
      .mapValue((v) => Result.ok(v.a))
      .handleError(ParseError, () => Result.ok(0));

    expect(out.value).toBe(0);
  });

  it("composes with registerExecution", () => {
    const parse = Result.fromThrowable(
      (raw: string) => JSON.parse(raw) as { port: number },
      () => new ParseError(),
    );

    const loadPort = Result.registerExecution((raw: string) =>
      parse(raw).mapValue((cfg) =>
        cfg.port > 0 ? Result.ok(cfg.port) : Result.err(new TimeoutError()),
      ),
    );

    expect(loadPort('{"port":8080}').value).toBe(8080);
    expect(loadPort("{").error).toBeInstanceOf(ParseError);
  });
});

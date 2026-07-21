import { describe, expect, it, vi } from "vitest";
import { Result } from "../src";
import {
  GatewayTimeoutError,
  NotFoundError,
  ParseError,
  RateLimitError,
  TimeoutError,
  TooSmallError,
} from "./helpers";

describe("handleError", () => {
  it("recovers from a matching error class", () => {
    const out = Result.err(new NotFoundError("u1")).handleError(NotFoundError, () =>
      Result.ok("fallback"),
    );
    expect(out.isOk).toBe(true);
    expect(out.value).toBe("fallback");
  });

  it("passes the matched error to the handler", () => {
    const out = Result.err(new TooSmallError(10)).handleError(TooSmallError, (e) =>
      Result.ok(e.limit),
    );
    expect(out.value).toBe(10);
  });

  it("leaves a non-matching error untouched", () => {
    const err = new ParseError("{");
    const handler = vi.fn(() => Result.ok("fallback"));
    const out = Result.err(err).handleError(NotFoundError, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(out.error).toBe(err);
  });

  it("does not run on a success", () => {
    const handler = vi.fn(() => Result.ok("fallback"));
    const out = Result.ok("original").handleError(NotFoundError, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(out.value).toBe("original");
  });

  it("accepts several error classes at once", () => {
    const handle = (r: Result<string, TimeoutError | RateLimitError>) =>
      r.handleError(TimeoutError, RateLimitError, (e) => Result.ok(`handled:${e._tag}`));

    expect(handle(Result.err(new TimeoutError())).value).toBe("handled:TimeoutError");
    expect(handle(Result.err(new RateLimitError())).value).toBe("handled:RateLimitError");
  });

  it("matches subclasses, because matching is instanceof", () => {
    const out = Result.err(new GatewayTimeoutError()).handleError(TimeoutError, () =>
      Result.ok("handled"),
    );
    expect(out.value).toBe("handled");
  });

  it("does not match a parent instance against a subclass", () => {
    const err = new TimeoutError();
    const out = Result.err(err).handleError(GatewayTimeoutError, () => Result.ok("handled"));
    expect(out.error).toBe(err);
  });

  it("can convert one error into another", () => {
    const out = Result.err(new TimeoutError()).handleError(TimeoutError, () =>
      Result.err(new RateLimitError()),
    );
    expect(out.error).toBeInstanceOf(RateLimitError);
  });

  it("peels errors off the union one handler at a time", () => {
    const run = (r: Result<number, ParseError | TimeoutError | NotFoundError>) =>
      r
        .handleError(ParseError, () => Result.ok(-1))
        .handleError(TimeoutError, () => Result.ok(-2))
        .handleError(NotFoundError, () => Result.ok(-3));

    expect(run(Result.err(new ParseError())).value).toBe(-1);
    expect(run(Result.err(new TimeoutError())).value).toBe(-2);
    expect(run(Result.err(new NotFoundError("x"))).value).toBe(-3);
    expect(run(Result.ok(5)).value).toBe(5);
  });

  it("does not re-handle an error produced by an earlier handler", () => {
    const second = vi.fn(() => Result.ok("second"));
    const out = Result.err(new ParseError())
      .handleError(ParseError, () => Result.err(new TimeoutError()))
      .handleError(ParseError, second);

    expect(second).not.toHaveBeenCalled();
    expect(out.error).toBeInstanceOf(TimeoutError);
  });

  it("runs the handler once even when several listed classes match", () => {
    const handler = vi.fn(() => Result.ok("once"));
    // GatewayTimeoutError is an instance of both listed classes.
    Result.err(new GatewayTimeoutError()).handleError(TimeoutError, GatewayTimeoutError, handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

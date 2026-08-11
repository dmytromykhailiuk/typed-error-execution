/**
 * `Result.collect` — like `all` for values, but it keeps every error at its own
 * index, with `null` where that member succeeded.
 */
import { describe, expect, it } from "vitest";
import { Result, ResultUnwrapError } from "../src";
import { NotFoundError, ParseError, TimeoutError, TooSmallError, tick } from "./helpers";

describe("Result.collect — success", () => {
  it("behaves exactly like all() when nothing failed", () => {
    const out = Result.collect([Result.ok("Ada"), Result.ok(36), Result.ok(true)]);
    expect(out).toBeInstanceOf(Result);
    expect(out.isOk).toBe(true);
    expect(out.value).toEqual(["Ada", 36, true]);
    expect(out.error).toBeUndefined();
  });

  it("handles an empty list synchronously", () => {
    const out = Result.collect([]);
    expect(out).toBeInstanceOf(Result);
    expect(out.isOk).toBe(true);
    expect(out.value).toEqual([]);
  });
});

describe("Result.collect — failure", () => {
  const nameErr = new ParseError("name");
  const emailErr = new ParseError("email");

  it("reports every error, positionally, with null where it succeeded", () => {
    const out = Result.collect([Result.err(nameErr), Result.ok(36), Result.err(emailErr)]);

    expect(out.isErr).toBe(true);
    expect(out.error).toEqual([nameErr, null, emailErr]);
  });

  it("keeps the error identity at each index", () => {
    const out = Result.collect([Result.err(nameErr), Result.ok(1)]);
    expect(out.error?.[0]).toBe(nameErr);
    expect(out.error?.[1]).toBeNull();
  });

  it("keeps the tuple length equal to the input length", () => {
    const out = Result.collect([Result.ok(1), Result.ok(2), Result.err(nameErr)]);
    expect(out.error).toHaveLength(3);
    expect(out.error).toEqual([null, null, nameErr]);
  });

  it("drops the values — a failure is a failure", () => {
    const out = Result.collect([Result.ok("kept?"), Result.err(nameErr)]);
    expect(out.value).toBeUndefined();
  });

  it("collects errors of different types side by side", () => {
    const notFound = new NotFoundError("u1");
    const tooSmall = new TooSmallError(10);
    const out = Result.collect([Result.err(notFound), Result.ok("fine"), Result.err(tooSmall)]);
    expect(out.error).toEqual([notFound, null, tooSmall]);
  });

  it("reports a single failure among many successes", () => {
    const out = Result.collect([Result.ok(1), Result.ok(2), Result.err(nameErr), Result.ok(4)]);
    expect(out.error).toEqual([null, null, nameErr, null]);
  });
});

describe("Result.collect — asynchronous", () => {
  it("goes async when any member is, and gathers every error", async () => {
    const slow = Result.try(
      async () => {
        await tick(15);
        throw new Error("slow");
      },
      () => new ParseError("slow"),
    );
    const okAsync = Result.ok("fine").toAsync();
    const fast = Result.try(
      async () => {
        await tick(1);
        throw new Error("fast");
      },
      () => new TimeoutError(),
    );

    const chain = Result.collect([slow, okAsync, fast]);
    expect(chain).not.toBeInstanceOf(Result);

    const out = await chain.getResult();
    expect(out.error?.[0]).toBeInstanceOf(ParseError);
    expect(out.error?.[1]).toBeNull();
    expect(out.error?.[2]).toBeInstanceOf(TimeoutError);
  });

  it("collects values when every async member succeeds", async () => {
    const out = await Result.collect([
      Result.ok(1),
      Result.ok(2).toAsync(),
      Promise.resolve(Result.ok(3)),
    ]).getResult();
    expect(out.value).toEqual([1, 2, 3]);
  });

  it("runs asynchronous members concurrently", async () => {
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

    const out = await Result.collect([make(1), make(2), make(3)]).getResult();
    expect(out.value).toEqual([1, 2, 3]);
    expect(peak).toBe(3); // all three overlapped; sequential would peak at 1
  });
});

describe("Result.collect — interaction with the rest of the API", () => {
  const err = new ParseError("name");

  it("chains onward on success", () => {
    const out = Result.collect([Result.ok("Ada"), Result.ok(36)]).mapValue(([name, age]) =>
      Result.ok(`${name} is ${age}`),
    );
    expect(out.value).toBe("Ada is 36");
  });

  it("short-circuits mapValue on failure like any other result", () => {
    const out = Result.collect([Result.err(err), Result.ok(1)]).mapValue(() => Result.ok("nope"));
    expect(out.isErr).toBe(true);
  });

  it("is readable through match", () => {
    const report = Result.collect([Result.err(err), Result.ok(36)]).match({
      ok: () => "all good",
      err: (errors) => errors.map((e) => e?._tag ?? "ok").join(","),
    });
    expect(report).toBe("ParseError,ok");
  });

  it("cannot be matched by handleError, because the error is a tuple", () => {
    const out = Result.collect([Result.err(err), Result.ok(1)])
      // @ts-expect-error the error is a tuple, so no error class can be in the union
      .handleError(ParseError, () => Result.ok(["recovered"] as unknown as [never, number]));
    // The handler never fires: the error is an array, not a ParseError instance.
    expect(out.isErr).toBe(true);
    expect(out.error).toEqual([err, null]);
  });

  it("describes the tuple in an unwrap() failure message", () => {
    try {
      Result.collect([Result.err(err), Result.ok(1)]).unwrap();
      expect.unreachable("unwrap() should have thrown");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(ResultUnwrapError);
      expect((thrown as ResultUnwrapError).message).toContain("[ParseError, null]");
    }
  });

  it("hands the whole tuple to unwrapOrElse", () => {
    const count = Result.collect([Result.err(err), Result.ok(1)]).unwrapOrElse(
      (errors) => errors.filter(Boolean).length,
    );
    expect(count).toBe(1);
  });
});

describe("Result.collect vs Result.all", () => {
  const first = new ParseError("first");
  const second = new NotFoundError("second");

  it("all reports only the first error", () => {
    const out = Result.all([Result.err(first), Result.err(second)]);
    expect(out.error).toBe(first);
  });

  it("collect reports both", () => {
    const out = Result.collect([Result.err(first), Result.err(second)]);
    expect(out.error).toEqual([first, second]);
  });

  it("they agree on the success case", () => {
    const inputs = [Result.ok(1), Result.ok(2)] as const;
    expect(Result.all(inputs).value).toEqual(Result.collect(inputs).value);
  });
});

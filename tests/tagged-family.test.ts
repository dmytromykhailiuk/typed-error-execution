/**
 * Families: `Tagged(tag, Parent)` composes a dotted path, and that path is what
 * carries the lineage into the type system while `instanceof` carries it at
 * runtime. These tests pin the runtime half down — the composed values, the
 * prototype chain, and that `handleError` subtracts a whole subtree.
 *
 * The type half lives in `types.test-d.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import { Result, Tagged, TaggedError } from "../src";

class PaymentError extends Tagged("PaymentError") {}
class Declined extends Tagged("Declined", PaymentError) {
  constructor(readonly code: string) {
    super();
  }
}
class CardExpired extends Tagged("CardExpired", Declined) {}
class Rejected extends Tagged("Rejected", PaymentError) {}
class Unrelated extends Tagged("Unrelated") {}

describe("a family of tags", () => {
  it("composes the tag from the whole path", () => {
    expect(new PaymentError()._tag).toBe("PaymentError");
    expect(new Declined("do_not_honour")._tag).toBe("PaymentError.Declined");
    expect(new CardExpired("exp")._tag).toBe("PaymentError.Declined.CardExpired");
  });

  it("has no depth limit", () => {
    class L2 extends Tagged("L2", Unrelated) {}
    class L3 extends Tagged("L3", L2) {}
    class L4 extends Tagged("L4", L3) {}
    class L5 extends Tagged("L5", L4) {}

    expect(new L5()._tag).toBe("Unrelated.L2.L3.L4.L5");
  });

  it("keeps instanceof against every ancestor", () => {
    const err = new CardExpired("exp");
    expect(err).toBeInstanceOf(CardExpired);
    expect(err).toBeInstanceOf(Declined);
    expect(err).toBeInstanceOf(PaymentError);
    expect(err).not.toBeInstanceOf(Rejected);
  });

  it("carries constructor arguments down the chain", () => {
    expect(new CardExpired("exp_2019").code).toBe("exp_2019");
  });

  it("keeps siblings apart", () => {
    expect(new Rejected()).not.toBeInstanceOf(Declined);
    expect(new Declined("x")).not.toBeInstanceOf(Rejected);
    expect(new Rejected()._tag).toBe("PaymentError.Rejected");
  });

  it("does not extend Error unless the root did", () => {
    expect(new CardExpired("exp")).not.toBeInstanceOf(Error);
  });

  it("puts _tag on the instance, not the prototype", () => {
    const err = new Declined("x");
    expect(Object.prototype.hasOwnProperty.call(err, "_tag")).toBe(true);
  });
});

describe("handleError over a family", () => {
  const boom = (): Result<number, CardExpired | Rejected> =>
    Math.random() < 2 ? Result.err(new CardExpired("exp")) : Result.err(new Rejected());

  it("an ancestor handles every descendant", () => {
    const out = boom().handleError(PaymentError, (e) => Result.ok(e._tag));
    expect(out.value).toBe("PaymentError.Declined.CardExpired");
  });

  it("a branch handles itself and below", () => {
    const out = Result.err(new CardExpired("exp")).handleError(Declined, () => Result.ok("branch"));
    expect(out.value).toBe("branch");
  });

  it("a leaf handles only itself", () => {
    const handler = vi.fn(() => Result.ok("leaf"));
    // The union holds the parent, so naming the child is a dead handler — the
    // type says so, and the runtime passes the error through.
    // @ts-expect-error CardExpired is below Declined, so it is not in the union
    const out = Result.err(new Declined("x")).handleError(CardExpired, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(out.isErr).toBe(true);
  });

  it("a sibling branch does not fire", () => {
    const handler = vi.fn(() => Result.ok("sibling"));
    // @ts-expect-error Rejected is a different branch of the same family
    const out = Result.err(new CardExpired("exp")).handleError(Rejected, handler);
    expect(handler).not.toHaveBeenCalled();
    expect(out.isErr).toBe(true);
  });

  it("names the full path when unwrap() fails", () => {
    expect(() => Result.err(new CardExpired("exp")).unwrap()).toThrow(
      /PaymentError\.Declined\.CardExpired/,
    );
  });
});

describe("Error-rooted families", () => {
  class Infra extends TaggedError("Infra") {}
  class DatabaseUnavailable extends TaggedError("DatabaseUnavailable", Infra) {}
  class PoolExhausted extends TaggedError("PoolExhausted", DatabaseUnavailable) {}

  it("composes the path and follows it in name", () => {
    const err = new PoolExhausted("no free connections");
    expect(err._tag).toBe("Infra.DatabaseUnavailable.PoolExhausted");
    expect(err.name).toBe("Infra.DatabaseUnavailable.PoolExhausted");
  });

  it("stays a real Error at every level", () => {
    const err = new DatabaseUnavailable("down");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(Infra);
    expect(err.message).toBe("down");
    expect(typeof err.stack).toBe("string");
  });

  it("lets a plain Tagged child hang off an Error family and stay an Error", () => {
    class ReadTimeout extends Tagged("ReadTimeout", DatabaseUnavailable) {}
    const err = new ReadTimeout("slow");

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DatabaseUnavailable);
    expect(err._tag).toBe("Infra.DatabaseUnavailable.ReadTimeout");
    expect(err.name).toBe("Infra.DatabaseUnavailable.ReadTimeout");
  });

  it("is handled by its root like any other family", () => {
    const out = Result.err(new PoolExhausted("x")).handleError(Infra, (e) => Result.ok(e.name));
    expect(out.value).toBe("Infra.DatabaseUnavailable.PoolExhausted");
  });
});

describe("a plain subclass still behaves as it always did", () => {
  it("inherits the parent's tag when no factory is used", () => {
    class Legacy extends PaymentError {}
    const err = new Legacy();

    expect(err._tag).toBe("PaymentError");
    expect(err).toBeInstanceOf(PaymentError);
  });
});

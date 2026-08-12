/**
 * A brand is a compile-time label, so most of what it does is asserted in
 * `types.test-d.ts`. What is left to pin down at runtime: that labelling costs
 * nothing, and that a predicate turns the same brand into a real check with
 * three ways in — throwing, guarding, and `Result`.
 */
import { describe, expect, it } from "vitest";
import { InvalidBrand, Result, brand } from "../src";

const UserId = brand("userId");
const Email = brand("email", (value: string) => value.includes("@"));
const Positive = brand("positive", (value: number) => value > 0);

describe("an unchecked brand", () => {
  it("hands the value back untouched", () => {
    const raw = "u_1";
    expect(UserId(raw)).toBe(raw);
  });

  it("adds nothing to the value", () => {
    // The label lives in the type only — nothing reaches the value, not even
    // the phantom symbol the type hangs off.
    const Session = brand<"session", { token: string }>("session");
    const raw = { token: "t_1" };
    const branded = Session(raw);

    expect(Object.keys(branded)).toEqual(Object.keys(raw));
    expect(Object.getOwnPropertySymbols(branded)).toEqual([]);
    expect(JSON.stringify({ id: UserId("u_1") })).toBe('{"id":"u_1"}');
  });

  it("reports the name it stamps", () => {
    expect(UserId.brandName).toBe("userId");
  });

  it("brands a non-string base too", () => {
    const OrderNo = brand<"orderNo", number>("orderNo");
    expect(OrderNo(42)).toBe(42);
  });
});

describe("a checked brand", () => {
  it("passes a valid value straight through", () => {
    expect(Email("user@example.com")).toBe("user@example.com");
  });

  it("throws InvalidBrand on an invalid one", () => {
    expect(() => Email("nope")).toThrow(InvalidBrand);
    expect(() => Email("nope")).toThrow(/nope is not a valid email/);
  });

  it("carries the brand and the value on the error", () => {
    try {
      Email("nope");
      expect.unreachable("Email() should have thrown");
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(InvalidBrand);
      expect((thrown as InvalidBrand).brandName).toBe("email");
      expect((thrown as InvalidBrand).value).toBe("nope");
      expect((thrown as InvalidBrand)._tag).toBe("InvalidBrand");
      expect(thrown).toBeInstanceOf(Error);
    }
  });

  it("guards with is()", () => {
    expect(Email.is("user@example.com")).toBe(true);
    expect(Email.is("nope")).toBe(false);
  });

  it("works over a numeric base inferred from the predicate", () => {
    expect(Positive(3)).toBe(3);
    expect(Positive.is(0)).toBe(false);
    expect(() => Positive(-1)).toThrow(InvalidBrand);
  });

  it("brands an object base", () => {
    const Config = brand("config", (value: { port: number }) => value.port > 0);
    const value = { port: 8080 };

    expect(Config(value)).toBe(value);
    expect(Config.is({ port: 0 })).toBe(false);
  });
});

describe("safe()", () => {
  it("returns ok for a valid value", () => {
    const out = Email.safe("user@example.com");
    expect(out.isOk).toBe(true);
    expect(out.value).toBe("user@example.com");
  });

  it("returns the same error the constructor throws", () => {
    const out = Email.safe("nope");
    expect(out.isErr).toBe(true);
    expect(out.error).toBeInstanceOf(InvalidBrand);
    expect(out.error?.brandName).toBe("email");
  });

  it("chains like any other Result", () => {
    const greet = (address: string) => `hello ${address}`;

    const ok = Email.safe("user@example.com")
      .mapValue((email) => Result.ok(greet(email)))
      .handleError(InvalidBrand, () => Result.ok("rejected"));
    expect(ok.value).toBe("hello user@example.com");

    const failed = Email.safe("nope")
      .mapValue((email) => Result.ok(greet(email)))
      .handleError(InvalidBrand, (e) => Result.ok(`rejected ${String(e.value)}`));
    expect(failed.value).toBe("rejected nope");
  });

  it("is convertible from the throwing form with Result.try", () => {
    const out = Result.try(
      () => Email("nope"),
      (thrown) => thrown as InvalidBrand,
    );
    expect(out.error).toBeInstanceOf(InvalidBrand);
  });
});

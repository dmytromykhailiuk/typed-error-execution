import { Result } from "./result";
import { TaggedError } from "./tagged";
import type { Brand, CheckedBrand } from "./types";

/**
 * What a checked brand reports when its predicate rejects a value.
 *
 * A real `Error` — a value failing validation is usually something you log or
 * report — and a tagged one, so it can equally be handled in a chain:
 * `chain.handleError(InvalidBrand, …)`.
 */
export class InvalidBrand extends TaggedError("InvalidBrand") {
  constructor(
    /** The brand that refused the value. */
    readonly brandName: string,
    /** The value it refused. */
    readonly value: unknown,
  ) {
    super(`${String(value)} is not a valid ${brandName}`);
  }
}

/**
 * Creates a brand: a label that lives only in the type system, so two values
 * that are the same underneath stop being interchangeable.
 *
 * ```ts
 * const UserId = brand("userId");
 * type UserId = BrandOf<typeof UserId>; // Branded<string, "userId">
 *
 * declare function loadUser(id: UserId): User;
 *
 * loadUser(UserId("u_1")); // ✓
 * loadUser("u_1"); //         ✗ a raw string is not a UserId
 * loadUser(orderId); //       ✗ and neither is another brand
 * ```
 *
 * The base type is `string` unless you say otherwise — either explicitly,
 * `brand<"orderNo", number>("orderNo")`, or by handing over a predicate, which
 * is where the base type is usually inferred from.
 *
 * Give it a **predicate** and the brand starts checking. The constructor then
 * validates and throws {@link InvalidBrand}; `is()` narrows; `safe()` hands back
 * a `Result` instead of throwing, which is the form the rest of this library is
 * built around:
 *
 * ```ts
 * const Email = brand("email", (value: string) => value.includes("@"));
 *
 * Email("nope"); //        throws InvalidBrand
 * Email.is(input); //      input is Branded<string, "email">
 * Email.safe(input) //     Result<Branded<string, "email">, InvalidBrand>
 *   .mapValue((email) => sendWelcome(email))
 *   .handleError(InvalidBrand, (e) => Result.ok(reject(e.value)));
 * ```
 *
 * Nothing is added to the value at runtime — an unchecked brand is the identity
 * function, and a checked one only runs your predicate. The label exists in the
 * type alone, which is also why a branded value still goes anywhere its base
 * type is accepted: `Branded<string, "userId">` *is* a `string`.
 *
 * You never have to use the factory: `Branded<string, "userId">` on its own is a
 * perfectly good brand if you would rather cast at the edges yourself.
 */
export function brand<const Name extends string, T = string>(name: Name): Brand<T, Name>;
export function brand<const Name extends string, T>(
  name: Name,
  is: (value: T) => boolean,
): CheckedBrand<T, Name>;
export function brand(name: string, is?: (value: unknown) => boolean) {
  if (!is) {
    const unchecked = (value: unknown) => value;
    return Object.assign(unchecked, { brandName: name });
  }

  const checked = (value: unknown) => {
    if (!is(value)) throw new InvalidBrand(name, value);
    return value;
  };

  return Object.assign(checked, {
    brandName: name,
    // `is` is handed a value of unknown provenance, so the predicate has to
    // survive being called with anything — that is the caller's contract to
    // keep, and the reason this takes `unknown` rather than `T`.
    is: (value: unknown) => is(value),
    safe: (value: unknown) =>
      is(value) ? Result.ok(value) : Result.err(new InvalidBrand(name, value)),
  });
}

import type {
  PathOf,
  RequireNoDot,
  TaggedClass,
  TaggedDescendant,
  TaggedErrorClass,
  TaggedErrorRoot,
  TaggedRoot,
} from "./types";

/**
 * Builds the class both factories hand back.
 *
 * Kept in one place because the only difference between a root and a
 * descendant is which class it extends — the tag, the path static and the
 * `name` fix-up are identical.
 */
function make(path: string, base: (abstract new (...args: any[]) => object) | undefined) {
  // `base` is abstract by design; `extends` needs a concrete construct
  // signature, and the cast is the whole of it — nothing is instantiated here.
  const Parent = (base ?? Object) as new (...args: any[]) => object;

  abstract class TaggedBase extends Parent {
    static readonly _tagPath = path;
    readonly _tag: string = path;

    constructor(...args: any[]) {
      super(...args);
      // A family may be rooted in `TaggedError`, in which case every level is a
      // real Error and `name` should say which one — matching what
      // `TaggedError` does for a root.
      if (this instanceof Error) this.name = path;
    }
  }

  return TaggedBase;
}

/**
 * Creates a base class that stamps a literal `_tag` onto every instance.
 *
 * The returned class is abstract on purpose: it exists to be extended, and
 * making it abstract stops `new (Tagged("X"))()` from producing an error that
 * no `handleError()` call can ever name.
 *
 * ```ts
 * class UserNotFound extends Tagged("UserNotFound") {
 *   constructor(readonly userId: string) {
 *     super();
 *   }
 * }
 * ```
 *
 * Pass a **parent class** as the second argument to make the new class a member
 * of that family. The tag becomes a dotted path, and that path is what carries
 * the lineage into the type system: `handleError(Parent, …)` handles every
 * descendant at any depth, and `handleError(Child, …)` handles that branch only.
 *
 * ```ts
 * class PaymentError extends Tagged("PaymentError") {}
 * class Declined extends Tagged("Declined", PaymentError) {}
 * class CardExpired extends Tagged("CardExpired", Declined) {}
 *
 * new CardExpired()._tag; // "PaymentError.Declined.CardExpired"
 *
 * chain.handleError(PaymentError, fn); // Declined and CardExpired too
 * chain.handleError(Declined, fn); //    Declined and CardExpired
 * chain.handleError(CardExpired, fn); //  CardExpired alone
 * ```
 *
 * Nesting is unlimited, and each level is a **distinct type** — which a plain
 * `class Child extends Parent {}` is not: with nothing added, it is structurally
 * identical to its parent, so `Child1 | Child2` collapses to one member and the
 * error union silently stops tracking which failure it is holding.
 *
 * Each call returns a *distinct* class, so two error types that happen to share
 * a tag string are still separate under `instanceof`.
 */
export function Tagged<Tag extends string>(tag: Tag & RequireNoDot<Tag>): TaggedRoot<Tag>;
export function Tagged<Tag extends string, B extends TaggedClass>(
  tag: Tag & RequireNoDot<Tag>,
  parent: B,
): TaggedDescendant<B, `${PathOf<B>}.${Tag}`>;
export function Tagged(tag: string, parent?: TaggedClass) {
  return make(parent ? `${parent._tagPath}.${tag}` : tag, parent) as never;
}

/**
 * Like {@link Tagged}, but the base also extends the native `Error`, so
 * instances carry a `message`, a `stack`, and print usefully in a console.
 *
 * Use this when the failure is something you will log, report to Sentry, or
 * hand to a framework that expects a real `Error`. Use {@link Tagged} when the
 * failure is a plain domain outcome and you want it to stay allocation-cheap —
 * capturing a stack trace is by far the most expensive part of an error.
 *
 * ```ts
 * class DatabaseUnavailable extends TaggedError("DatabaseUnavailable") {}
 *
 * const err = new DatabaseUnavailable("connection pool exhausted");
 * err._tag; // "DatabaseUnavailable"
 * err.name; // "DatabaseUnavailable"
 * err.stack; // real stack trace
 * ```
 *
 * The second argument builds a family exactly as {@link Tagged} does, and
 * `name` follows the composed path so a report says which member it was:
 *
 * ```ts
 * class Infra extends TaggedError("Infra") {}
 * class DatabaseUnavailable extends TaggedError("DatabaseUnavailable", Infra) {}
 *
 * const err = new DatabaseUnavailable("pool exhausted");
 * err._tag; // "Infra.DatabaseUnavailable"
 * err.name; // "Infra.DatabaseUnavailable"
 * err instanceof Infra; // true
 * ```
 *
 * The parent must already be an `Error` family — `Error` can only enter the
 * chain at its root. To hang a plain family off an `Error` one, use
 * `Tagged(tag, ErrorParent)`: everything below inherits the `Error`.
 */
export function TaggedError<Tag extends string>(tag: Tag & RequireNoDot<Tag>): TaggedErrorRoot<Tag>;
export function TaggedError<Tag extends string, B extends TaggedErrorClass>(
  tag: Tag & RequireNoDot<Tag>,
  parent: B,
): TaggedDescendant<B, `${PathOf<B>}.${Tag}`>;
export function TaggedError(tag: string, parent?: TaggedErrorClass) {
  return make(parent ? `${parent._tagPath}.${tag}` : tag, parent ?? Error) as never;
}

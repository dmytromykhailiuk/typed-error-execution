import type { InvalidBrand } from "./branded";
import type { Result } from "./result";

/**
 * The shape every error in this library must have: a discriminant literal.
 *
 * You never implement this by hand — `Tagged()` and `TaggedError()`
 * produce base classes that satisfy it.
 */
export interface Tagged {
  readonly _tag: string;
}

/**
 * The phantom key a brand hangs off.
 *
 * A `unique symbol` rather than a plain property name: it cannot collide with
 * anything real, it never shows up in autocomplete, and it exists only in the
 * type — nothing is added to the value at runtime.
 */
declare const BRAND: unique symbol;

/**
 * A base type carrying a compile-time-only label, so two values that are the
 * same underneath stop being interchangeable.
 *
 * ```ts
 * type UserId = Branded<string, "userId">;
 * type OrderId = Branded<string, "orderId">;
 *
 * declare function loadUser(id: UserId): User;
 * loadUser(orderId); // ✗ the wrong id no longer compiles
 * ```
 *
 * The label is **required**, which is what stops a raw `string` from passing as
 * a `UserId`. The other direction still works: a `Branded<string, …>` *is* a
 * `string`, so it goes anywhere a string is expected without unwrapping.
 */
export type Branded<T, Name extends string> = T & { readonly [BRAND]: Name };

/**
 * The type a {@link brand} factory produces, so the name is written once:
 *
 * ```ts
 * const UserId = brand("userId");
 * type UserId = BrandOf<typeof UserId>; // Branded<string, "userId">
 * ```
 */
export type BrandOf<F> = F extends Brand<infer T, infer Name> ? Branded<T, Name> : never;

/**
 * An unchecked brand: a constructor that labels a value, and the name it
 * stamps. Returned by `brand(name)`.
 *
 * There is no `is` here on purpose — with no predicate to run, a check could
 * only ever answer "yes", and a guard that cannot fail is worse than none.
 */
export interface Brand<T, Name extends string> {
  /** Labels `value`. Purely a compile-time move: the value comes back as it went in. */
  (value: T): Branded<T, Name>;
  /** The label this brand stamps. */
  readonly brandName: Name;
}

/**
 * A brand with a predicate behind it, returned by `brand(name, is)`. The
 * constructor now validates, and two more ways in appear.
 */
export interface CheckedBrand<T, Name extends string> extends Brand<T, Name> {
  /** Labels `value`, or throws `InvalidBrand` when the predicate rejects it. */
  (value: T): Branded<T, Name>;
  /** Narrowing guard — the predicate, with the type to match. */
  is(value: unknown): value is Branded<T, Name>;
  /** The same check as calling it, as a `Result` instead of a throw. */
  safe(value: T): Result<Branded<T, Name>, InvalidBrand>;
}

/**
 * Any class (abstract or concrete) whose instances are `Tagged`.
 *
 * This is what `handleError()` accepts: the constructor itself, not an
 * instance and not a tag string — matching is `instanceof`, so subclasses of a
 * handled class are handled too.
 */
export type ErrorClass = abstract new (...args: any[]) => Tagged;

/**
 * Compile-time guard against a widened `_tag`.
 *
 * If `_tag` widened to `string` the union in `Result<T, E>` collapses and error
 * tracking silently stops working. Intersecting an argument with this type
 * turns that into a readable compile error at the call site instead.
 */
export type RequireLiteralTag<E extends Tagged> = string extends E["_tag"]
  ? {
      ERROR: "_tag must be a string literal — declare the class as `class X extends Tagged('X') {}`";
    }
  : unknown;

/**
 * Compile-time guard against a hand-written `.` in a tag.
 *
 * A dot separates the levels of a family — `Tagged("Child", Parent)` composes
 * `"Parent.Child"` for you. Writing one by hand would claim a lineage the class
 * does not actually have, and the type layer would believe it while `instanceof`
 * did not.
 */
export type RequireNoDot<Tag extends string> = Tag extends `${string}.${string}`
  ? {
      ERROR: "a tag may not contain `.` — it separates the levels of a family, and `Tagged(tag, Parent)` composes it for you";
    }
  : unknown;

/** The `_tag` of an error, or `never` for anything that is not one. */
export type TagOf<X> = X extends Tagged ? X["_tag"] : never;

/**
 * Every tag a class handles: its own, plus every path descending from it.
 *
 * This is the type-level counterpart of `instanceof`. A family is spelled as a
 * dotted path — `"Payment"`, `"Payment.Declined"`, `"Payment.Declined.Expired"`
 * — so "is a descendant of" is "has this tag, or starts with it and a dot".
 */
type DescendantTags<C extends ErrorClass> = TagOf<InstanceType<C>> extends infer T extends string
  ? T | `${T}.${string}`
  : never;

/**
 * The members of the error union `E` that class `C` handles — itself and every
 * descendant of it.
 *
 * Errors that are not `Tagged` at all (the tuple `Result.collect` produces) match
 * nothing, which is what makes {@link HandleableClass} reject them.
 */
export type MatchedBy<E, C extends ErrorClass> = E extends Tagged
  ? TagOf<E> extends DescendantTags<C>
    ? E
    : never
  : never;

/** The complement of {@link MatchedBy}: what survives the handler. */
export type UnmatchedBy<E, C extends ErrorClass> = E extends Tagged
  ? TagOf<E> extends DescendantTags<C>
    ? never
    : E
  : E;

/**
 * Compile-time guard for one class passed to `handleError()`.
 *
 * Handling is subtraction, so naming a class the `Result` cannot be carrying is
 * always a mistake: either the error was already handled upstream, or the wrong
 * class was named. Both used to compile into a step that provably never runs.
 * This turns them into a compile error at the class that does not fit.
 *
 * The test is {@link MatchedBy}, so a class also matches every descendant in its
 * family — `instanceof` handles a whole subtree, and the type has to agree.
 */
export type HandleableClass<E, C extends ErrorClass> = [E] extends [never]
  ? {
      ERROR: "there is nothing left to handle — the error union of this Result is already `never`";
    }
  : [MatchedBy<E, C>] extends [never]
    ? {
        ERROR: "this error class is not in the error union of this Result, so handling it would do nothing";
      }
    : C;

/**
 * {@link HandleableClass} applied across the whole class list of a
 * `handleError()` call, so the error lands on the offending argument rather
 * than on the call as a whole.
 */
export type HandleableClasses<E, Cs extends readonly ErrorClass[]> = {
  [K in keyof Cs]: HandleableClass<E, Cs[K]>;
};

/**
 * A class one of the factories produced: it carries its own dotted path as a
 * static, which is what lets the next level compose on top of it — at runtime
 * *and* in the type.
 *
 * `_tag` lives on the instance, so the path could not be read off the
 * constructor without it.
 */
export type TaggedClass = (abstract new (
  ...args: any[]
) => Tagged) & {
  readonly _tagPath: string;
};

/** A {@link TaggedClass} whose instances are also real `Error`s. */
export type TaggedErrorClass = TaggedClass & (abstract new (...args: any[]) => Error);

/** The dotted path of a {@link TaggedClass}, used to compose its children. */
export type PathOf<B extends TaggedClass> = B["_tagPath"];

/** What `Tagged(tag)` / `TaggedError(tag)` return: the root of a family. */
export type TaggedRoot<Path extends string, I = unknown> = (abstract new () => I & {
  readonly _tag: Path;
}) & { readonly _tagPath: Path };

/** What `TaggedError(tag)` returns: a root whose instances are `Error`s. */
export type TaggedErrorRoot<Path extends string> = (abstract new (
  message?: string,
) => Error & { readonly _tag: Path }) & { readonly _tagPath: Path };

/**
 * What `Tagged(tag, Parent)` returns: everything the parent has, with the tag
 * replaced by the composed path.
 *
 * `Omit` is what re-tags the instance — a plain `extends` could not, because a
 * narrower `_tag` is not assignable to the parent's. It carries public members
 * across; `private`/`protected` ones do not survive, which is why the factories
 * declare none.
 */
export type TaggedDescendant<B extends TaggedClass, Path extends string> = (abstract new (
  ...args: ConstructorParameters<B>
) => Omit<InstanceType<B>, "_tag"> & { readonly _tag: Path }) & {
  readonly _tagPath: Path;
} & Omit<B, "prototype" | "_tagPath">;

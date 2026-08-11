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
 * Compile-time guard for one class passed to `handleError()`.
 *
 * Handling is subtraction, so naming a class the `Result` cannot be carrying is
 * always a mistake: either the error was already handled upstream, or the wrong
 * class was named. Both used to compile into a step that provably never runs.
 * This turns them into a compile error at the class that does not fit.
 *
 * The test is `Extract`, not assignability, so a **base** class still matches a
 * union member that subclasses it — `instanceof` handles a family of errors, and
 * the type has to agree.
 */
export type HandleableClass<E, C extends ErrorClass> = [E] extends [never]
  ? {
      ERROR: "there is nothing left to handle — the error union of this Result is already `never`";
    }
  : [Extract<E, InstanceType<C>>] extends [never]
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

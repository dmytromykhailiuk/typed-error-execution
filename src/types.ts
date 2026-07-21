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

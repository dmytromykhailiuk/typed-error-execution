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
 * Each call returns a *distinct* class, so two error types that happen to share
 * a tag string are still separate under `instanceof`.
 */
export function Tagged<Tag extends string>(tag: Tag) {
  abstract class TaggedBase {
    readonly _tag: Tag = tag;
  }
  return TaggedBase;
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
 */
export function TaggedError<Tag extends string>(tag: Tag) {
  abstract class TaggedErrorBase extends Error {
    readonly _tag: Tag = tag;

    constructor(message?: string) {
      super(message);
      this.name = tag;
    }
  }
  return TaggedErrorBase;
}

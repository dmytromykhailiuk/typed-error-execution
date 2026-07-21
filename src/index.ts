/**
 * typed-error-execution — errors that live in the type system.
 *
 * A `Result<T, E>` is a value that either succeeded with a `T` or failed with
 * one of the tagged errors in `E`. Errors are ordinary class instances carrying
 * a literal `_tag`, so TypeScript can track exactly which failures a call can
 * still produce, and `handleError()` removes them from that union one by one
 * until nothing is left.
 *
 * The public surface is deliberately four names. Everything else — the
 * asynchronous half of a chain, the type helpers, the runtime guards — is
 * reached through `Result` itself or inferred for you.
 *
 * @packageDocumentation
 */

export { Result, ResultUnwrapError } from "./result";
export { Tagged, TaggedError } from "./tagged";

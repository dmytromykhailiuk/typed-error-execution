import { Tagged, TaggedError } from "../src";

export class NotFoundError extends Tagged("NotFoundError") {
  constructor(readonly id: string) {
    super();
  }
}

export class ParseError extends Tagged("ParseError") {
  constructor(readonly raw: string = "") {
    super();
  }
}

export class TooSmallError extends Tagged("TooSmallError") {
  constructor(readonly limit: number) {
    super();
  }
}

export class TimeoutError extends Tagged("TimeoutError") {}

export class RateLimitError extends Tagged("RateLimitError") {}

export class DatabaseError extends TaggedError("DatabaseError") {}

/** A subclass, to pin down that `handleError` matching is `instanceof`. */
export class GatewayTimeoutError extends TimeoutError {}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

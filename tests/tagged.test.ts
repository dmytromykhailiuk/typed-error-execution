import { describe, expect, it } from "vitest";
import { Tagged, TaggedError } from "../src";
import { DatabaseError, GatewayTimeoutError, NotFoundError, TimeoutError } from "./helpers";

describe("Tagged", () => {
  it("stamps the literal tag onto instances", () => {
    expect(new NotFoundError("u1")._tag).toBe("NotFoundError");
  });

  it("keeps constructor arguments as instance data", () => {
    expect(new NotFoundError("u1").id).toBe("u1");
  });

  it("does not extend Error", () => {
    expect(new NotFoundError("u1")).not.toBeInstanceOf(Error);
  });

  it("supports instanceof against its own class", () => {
    expect(new TimeoutError()).toBeInstanceOf(TimeoutError);
  });

  it("treats a subclass as an instance of its parent", () => {
    const err = new GatewayTimeoutError();
    expect(err).toBeInstanceOf(GatewayTimeoutError);
    expect(err).toBeInstanceOf(TimeoutError);
    // The tag is inherited — subclasses share the parent's discriminant unless
    // they extend a fresh Tagged() of their own.
    expect(err._tag).toBe("TimeoutError");
  });

  it("gives each call a distinct class even for the same tag string", () => {
    class A extends Tagged("Same") {}
    class B extends Tagged("Same") {}

    expect(new A()._tag).toBe(new B()._tag);
    expect(new A()).not.toBeInstanceOf(B);
    expect(new B()).not.toBeInstanceOf(A);
  });

  it("puts _tag on the instance, not the prototype", () => {
    const err = new NotFoundError("u1");
    expect(Object.prototype.hasOwnProperty.call(err, "_tag")).toBe(true);
  });
});

describe("TaggedError", () => {
  it("stamps the tag and the Error name", () => {
    const err = new DatabaseError("connection refused");
    expect(err._tag).toBe("DatabaseError");
    expect(err.name).toBe("DatabaseError");
  });

  it("is a real Error with a message and a stack", () => {
    const err = new DatabaseError("connection refused");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("connection refused");
    expect(typeof err.stack).toBe("string");
  });

  it("works without a message", () => {
    class Bare extends TaggedError("Bare") {}
    expect(new Bare().message).toBe("");
  });

  it("survives instanceof through a subclass", () => {
    class Nested extends DatabaseError {}
    const err = new Nested("x");
    expect(err).toBeInstanceOf(DatabaseError);
    expect(err).toBeInstanceOf(Error);
  });
});

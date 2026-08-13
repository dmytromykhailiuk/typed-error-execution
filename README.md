# typed-error-execution

> **Full documentation:** open [Docs](https://dmytromykhailiuk.github.io/typed-error-execution/)

**Errors that live in the type system.**

A `Result<T, E>` either succeeded with a `T` or failed with one of the tagged errors in `E`. Errors are ordinary classes carrying a literal `_tag`, so TypeScript tracks exactly which failures a call can still produce — and `handleError()` removes them from that union one at a time until nothing is left.

Inspired by [Effect](https://effect.website/) and [neverthrow](https://github.com/supermacro/neverthrow), but deliberately small: **six runtime exports**, one API for sync and async, no generators, no runtime, no fibers. Zero dependencies.

```ts
import {
  Result,
  Tagged,
  TaggedError,
} from "@dmytromykhailiuk/typed-error-execution";

class ValidationFailed extends Tagged("ValidationFailed") {
  constructor(readonly field: string, readonly reason: string) {
    super();
  }
}
class EmailAlreadyRegistered extends Tagged("EmailAlreadyRegistered") {
  constructor(readonly email: string) {
    super();
  }
}
// An infrastructure failure extends the native Error, so it has a stack.
class DatabaseUnavailable extends TaggedError("DatabaseUnavailable") {}

const registerUser = Result.registerExecution(async (input: SignUpInput) => {
  if (input.password.length < 12) {
    return Result.err(
      new ValidationFailed("password", "must be at least 12 characters")
    );
  }

  const existing = await db.users.findByEmail(input.email);
  if (existing) return Result.err(new EmailAlreadyRegistered(input.email));

  return Result.ok(await db.users.insert(input));
});
// (input: SignUpInput) => AsyncResult<User, ValidationFailed | EmailAlreadyRegistered>

const settled = await registerUser(req.body)
  .mapValue((user) => Result.ok({ status: 201, body: publicProfile(user) }))
  .handleError(ValidationFailed, (e) =>
    Result.ok({ status: 422, body: { field: e.field, reason: e.reason } })
  )
  .handleError(EmailAlreadyRegistered, () =>
    Result.ok({ status: 409, body: { error: "that email is already in use" } })
  )
  .getResult(); // Result<Response, never> — every failure is now a response

const response = settled.unwrap(); // safe, and the compiler knows it
```

---

## Contents

- [Install](#install)
- [Why](#why)
- [Defining errors](#defining-errors)
- [Branding values](#branding-values)
- [Creating results](#creating-results)
- [One method, sync or async](#one-method-sync-or-async)
- [Registering executions](#registering-executions)
- [Transforming](#transforming)
- [Handling errors](#handling-errors)
- [Asynchronous chains](#asynchronous-chains)
- [Combining results](#combining-results)
- [Collecting every error](#collecting-every-error)
- [Getting the value out](#getting-the-value-out)
- [Bridging code that throws](#bridging-code-that-throws)
- [Recipes](#recipes)
- [TypeScript notes](#typescript-notes)
- [API reference](#api-reference)
- [Comparison](#comparison)
- [Development](#development)

---

## Install

```sh
npm i @dmytromykhailiuk/typed-error-execution
```

No peer dependencies. TypeScript **5.0+** is required (the `const` type parameters used by `all()` landed in 5.0). ESM and CJS builds are both published, with separate `.d.ts` / `.d.cts` declarations.

### The whole surface

```ts
import {
  Result, // the type, and every static that builds or combines one
  Tagged, // base class factory for domain errors, and for families of them
  TaggedError, // the same, but extending the native Error
  ResultUnwrapError, // what unwrap() throws
  brand, // labels for values that must not be interchangeable
  InvalidBrand, // what a checked brand reports
  type Branded, // the same label, as a type
  type BrandOf, // the type a brand() factory produces
  type Brand, // the shape of a brand() factory itself
  type CheckedBrand, // the same, with is() and safe() on it
} from "@dmytromykhailiuk/typed-error-execution";
```

Everything else lives on `Result`. There is no `AsyncResult` to import — the asynchronous half of a chain is produced for you and inferred at every step, so you use it constantly without ever naming it.

---

## Why

A thrown error is invisible to the type system. `async function registerUser(input: SignUpInput): Promise<User>` tells you nothing about the five ways it can fail — a uniqueness check, a password policy, a database write, a call to a payment provider — and nothing breaks when a sixth is added.

This library makes failure part of the return type:

```ts
function registerUser(
  input: SignUpInput
): AsyncResult<
  User,
  ValidationFailed | EmailAlreadyRegistered | DatabaseUnavailable
>;
```

Three properties follow from that, and they are the whole point:

1. **You cannot forget a failure.** The union is in the signature. Adding a new error to a function surfaces as a type change at every call site.
2. **Handling is subtraction.** Every `handleError()` removes exactly the classes you named. When the union reaches `never`, the compiler knows the value is safe.
3. **Nothing is magic.** Errors are `class` instances. Matching is `instanceof`. A `Result` is a two-field object. You can read the entire implementation in one sitting.

### What it deliberately does not do

No effect system, no dependency injection, no generator syntax, no retry/schedule combinators, no runtime to install. If you need those, use Effect — it is excellent and this is not trying to replace it. This is the layer below: typed errors and nothing else.

---

## Defining errors

An error is a class extending `Tagged(tag)`. The tag is a **string literal** — that literal is what makes the union in `Result<T, E>` meaningful.

```ts
class UserNotFound extends Tagged("UserNotFound") {
  constructor(readonly userId: string) {
    super();
  }
}

class SubscriptionRequired extends Tagged("SubscriptionRequired") {
  constructor(readonly currentPlan: string, readonly requiredPlan: string) {
    super();
  }
}

class RateLimited extends Tagged("RateLimited") {
  constructor(readonly retryAfterSeconds: number) {
    super();
  }
}
```

Errors carry whatever data you give them. That data survives the whole chain and is fully typed inside a handler.

### `Tagged` vs `TaggedError`

|                     | `Tagged`        | `TaggedError`                      |
| ------------------- | --------------- | ---------------------------------- |
| Extends `Error`     | no              | yes                                |
| `message` / `stack` | no              | yes                                |
| Cost to construct   | a plain object  | captures a stack trace             |
| Use for             | domain outcomes | things you log, report, or `throw` |

```ts
class DatabaseUnavailable extends TaggedError("DatabaseUnavailable") {}
class PaymentGatewayError extends TaggedError("PaymentGatewayError") {}

const err = new DatabaseUnavailable("connection pool exhausted after 5000ms");
err._tag; // "DatabaseUnavailable"
err.name; // "DatabaseUnavailable"
err.message; // "connection pool exhausted after 5000ms"
err.stack; // a real stack trace
err instanceof Error; // true — Sentry, pino and friends handle it correctly

logger.error({ err }, "query failed"); // serialises like any other Error
```

Capturing a stack trace is by far the most expensive part of creating an error. If a failure is an ordinary control-flow outcome — "this user does not exist" — `Tagged` keeps it as cheap as returning a value, which is what it is.

> **Each call to** `Tagged()` **returns a distinct class.** Two error types that happen to share a tag string are still separate under `instanceof`, so `handleError` will not confuse them at runtime. In the type system they are indistinguishable — nothing tells two identical shapes apart — so give each failure its own tag.

### Error inheritance

Errors inherit from one another: pass the parent class as the second argument. A class and everything below it form a **family**. The tag becomes a dotted path, and that path is what carries the lineage into the type system.

```ts
class PaymentError extends Tagged("PaymentError") {}
class Declined extends Tagged("Declined", PaymentError) {}
class CardExpired extends Tagged("CardExpired", Declined) {}
class Rejected extends Tagged("Rejected", PaymentError) {}

new CardExpired()._tag; // "PaymentError.Declined.CardExpired"
new CardExpired() instanceof PaymentError; // true
```

`handleError` handles a class **and everything below it**, at any depth:

| Handled class    | Also handles                                | Leaves        |
| ---------------- | ------------------------------------------- | ------------- |
| `PaymentError`   | `Declined`, `CardExpired`, `Rejected`       | —             |
| `Declined`       | `CardExpired`                               | `Rejected`    |
| `CardExpired`    | —                                           | `Rejected`    |

```ts
charge(order) // AsyncResult<Receipt, CardExpired | Rejected>
  .handleError(Declined, (e) => Result.ok(retry(e))) // CardExpired too
  .handleError(Rejected, () => Result.ok(abandon()));
// AsyncResult<Receipt, never>
```

Nesting is unlimited, and each level is a **distinct type**. That is the whole reason the second argument exists — a plain `class Child extends Parent {}` adds nothing, so it is structurally identical to its parent, and TypeScript collapses `Child1 | Child2` into one member. The error union then silently stops tracking which failure it is holding:

```ts
class Random1Error extends RandomError {} // ✗ same type as RandomError
class Random2Error extends RandomError {} // ✗ same type again
// Result<number, Random1Error | Random2Error>  →  Result<number, Random1Error>

class Random1Error extends Tagged("Random1Error", RandomError) {} // ✓ its own type
class Random2Error extends Tagged("Random2Error", RandomError) {} // ✓ its own type
```

A plain `extends` still behaves exactly as it always did — the child inherits the parent's tag and is handled by it — so nothing that already works breaks. It just cannot tell two children apart.

> **A tag may not contain a dot.** The dot separates the levels of a family and `Tagged(tag, Parent)` composes it for you. Writing `Tagged("PaymentError.Faked")` by hand is a compile error, because it would claim a lineage that `instanceof` does not back.

`TaggedError` takes the same second argument, and `name` follows the composed path so a report says which member it was. `Error` can only enter a chain at its root: build the family with `TaggedError` at the top, and every level below is a real `Error` — including levels declared with plain `Tagged(tag, Parent)`.

---

## Branding values

The same idea as a tagged error, applied to ordinary values: a label that exists only in the type, so two things that are the same underneath stop being interchangeable.

```ts
type UserId = Branded<string, "userId">;
type OrderId = Branded<string, "orderId">;

declare function loadUser(id: UserId): User;

loadUser(orderId); // ✗ the wrong id no longer compiles
```

`brand()` is the same thing as a factory, so the name is written once and you get a constructor with it:

```ts
const UserId = brand("userId");
type UserId = BrandOf<typeof UserId>; // Branded<string, "userId">

loadUser(UserId("u_1")); // ✓
loadUser("u_1"); //         ✗ a raw string is not a UserId
```

The base type is `string` unless you say otherwise — `brand<"orderNo", number>("orderNo")`, or by handing over a predicate, which is where it is normally inferred from.

A branded value **is** its base type, so it goes anywhere a `string` is expected and keeps every method. Only the other direction is blocked, which is the whole point — there is nothing to unwrap.

### Checked brands

Give `brand()` a predicate and the label starts being earned rather than asserted:

```ts
const Email = brand("email", (value: string) => value.includes("@"));

Email("user@example.com"); // Branded<string, "email">
Email("nope"); //            throws InvalidBrand

if (Email.is(input)) sendWelcome(input); // input: Branded<string, "email">
```

`safe()` is the same check as a `Result`, so validation joins the chain instead of interrupting it:

```ts
Email.safe(req.body.email) // Result<Branded<string, "email">, InvalidBrand>
  .mapValue((email) => sendWelcome(email))
  .handleError(InvalidBrand, (e) => Result.ok(reject(e.value)));
```

`InvalidBrand` is both a real `Error` and a tagged one, so it works in a `catch` and in `handleError` alike. It carries `brandName` and the `value` that was refused.

> **Without a predicate there is no checker.** `brand(name)` gives you a constructor and nothing else — no `is`, no `safe`. A guard with no predicate behind it could only ever answer "yes", which is worse than not having one.

Nothing is added to the value at runtime: an unchecked brand is the identity function, and a checked one only runs your predicate.

---

## Creating results

```ts
Result.ok(user); // Result<User, never>
Result.ok(); // Result<void, never>  — a command succeeded
Result.empty(); // Result<null, never>  — nothing to return
Result.err(new UserNotFound("u_8123")); // Result<never, UserNotFound>
```

`ok()` and `empty()` differ in intent: `void` is the absence of a value, `null` is a value you can branch on. `empty()` reads well as the "nothing to do, and that's fine" branch of a handler.

### The literal-tag rule

`Result.err()` rejects an error whose `_tag` has widened to `string`, because a widened tag silently collapses the union and switches off error tracking:

```ts
class HandRolled {
  readonly _tag: string = "HandRolled"; // ← widened, not a literal
}

Result.err(new HandRolled());
// Argument of type 'HandRolled' is not assignable to parameter of type
// '{ ERROR: "_tag must be a string literal — declare the class as
//    `class X extends Tagged('X') {}`" }'
```

Extending `Tagged()` always produces a literal, so in practice you never see this.

---

## One method, sync or async

There is no `mapValueAsync`, no `tryAsync`, no `registerAsyncExecution`. Every method takes a callback and looks at **what the callback actually returned**:

- returns a **result** → the chain stays synchronous, and the value is readable on the next line;
- returns a **promise or an async chain** → the rest of the chain is asynchronous, finished with `await` or `getResult()`.

```ts
// validating a request body: no I/O, so no promise anywhere
const plan = parsePlan(req.body.plan).unwrapOr("free");

// loading a user: I/O, so the chain is asynchronous from here on
const profile = await loadUser(userId)
  .mapValue((user) => Result.ok(publicProfile(user)))
  .getResult();

// It is about the value, not the keyword — anything promise-shaped counts.
Result.ok(userId).mapValue((id) => db.users.findById(id)); // async
Result.ok(userId).mapValue((id) => loadUser(id)); // async: loadUser is async
```

The check is `instanceof` on what came back — there are no heuristics applied to the function itself. The same rule governs every entry point:

| Call                                    | Synchronous when              | Asynchronous when                               |
| --------------------------------------- | ----------------------------- | ----------------------------------------------- |
| `mapValue` · `mapError` · `handleError` | the callback returns a result | it returns a promise or an async chain          |
| `tap` · `tapError`                      | the effect returns nothing    | the effect returns a promise (which is awaited) |
| `Result.try` · `Result.fromThrowable`   | the body returns a value      | the body returns a promise                      |
| `Result.registerExecution`              | the body returns a result     | the body is `async`                             |
| `Result.all` · `Result.collect`         | every member is synchronous   | any member is asynchronous                      |

Types follow exactly the same rule, so the editor agrees with the runtime. A callback with one sync branch and one async branch counts as asynchronous — the safe reading.

### Skipped steps

A chain short-circuits: `Result.err(e).mapValue(fn)` never calls `fn`. There is no returned value to inspect, so the step reads the callback itself — an `async` function is identifiable at runtime, and the chain becomes a real asynchronous one even though nothing ran.

```ts
const chain = Result.err(new UserNotFound("u_1")).mapValue(async (u: User) =>
  Result.ok(await enrich(u))
);
// an async chain, in the type and at runtime — enrich was never called

// a synchronous callback keeps the step synchronous, so the value is right here
Result.err(new UserNotFound("u_1")).mapValue((u: User) => Result.ok(u.email))
  .error;
```

Detection covers arrows, declarations, methods and bound functions.

> **Reading the function is only needed when the step is skipped.** When it runs, the callback's returned value is checked with `instanceof` — exact, no heuristic — so a function that merely returns a promise is handled correctly there.

```ts
const notAsync = (u: User) => enrich(u); // returns a promise, not declared async

// Both lines are typed AsyncResult<Enriched, …> — the callback's signature says
// so, and the type is the same either way. Only the runtime class differs.
Result.ok(user).mapValue(notAsync);
// runs    → the returned promise is seen → a real AsyncResult ✓

Result.err(e).mapValue(notAsync);
// skipped → nothing was returned → a Result, standing in for the chain
```

On a skipped step there is no returned value to look at, and the callback cannot simply be called to find out: an errored result has no value to pass it, and running it would perform exactly the work the short-circuit exists to avoid. All that is left is the function object, which reveals `async` but not _returns a promise_.

So the gap is narrow: a skipped step whose callback is not declared `async` but would have returned a promise. Any `async` function passed through a wrapper lands here too, since a decorator or spy hands back an ordinary function.

That residual case is safe rather than merely tolerated: **every member the asynchronous type exposes works on a** `Result`. The chaining methods and terminals are shared outright, and awaiting a non-promise yields it unchanged. `getResult()` is the one that needs help, and `Result` carries it as a **private** method for exactly this reason — on the prototype, absent from the public API, because a synchronous result has nothing to resolve.

The guess only ever errs in the safe direction: a `Result` can stand in for a chain, but a chain cannot stand in for a `Result`, because reading `.value` off one would silently yield `undefined`. Both rules are pinned down by `tests/short-circuit.test.ts`.

---

## Registering executions

Left alone, TypeScript infers a function with several `return` branches as a **union of results**:

```ts
const chargeSubscription = async (userId: string, cents: number) => {
  const user = await db.users.findById(userId);
  if (!user) return Result.err(new UserNotFound(userId));
  if (!user.paymentMethodId) return Result.err(new NoPaymentMethod(userId));

  const charge = await stripe.charges.create({
    amount: cents,
    customer: user.stripeId,
  });
  if (charge.status === "failed")
    return Result.err(new PaymentDeclined(charge.failureCode));

  return Result.ok(charge);
};
// Promise<Result<never, UserNotFound> | Result<never, NoPaymentMethod>
//         | Result<never, PaymentDeclined> | Result<Charge, never>>
```

That type is nearly unchainable. `registerExecution` collapses it into one result whose error parameter is the union — which is what you actually meant:

```ts
const chargeSubscription = Result.registerExecution(
  async (userId: string, cents: number) => {
    const user = await db.users.findById(userId);
    if (!user) return Result.err(new UserNotFound(userId));
    if (!user.paymentMethodId) return Result.err(new NoPaymentMethod(userId));

    const charge = await stripe.charges.create({
      amount: cents,
      customer: user.stripeId,
    });
    if (charge.status === "failed")
      return Result.err(new PaymentDeclined(charge.failureCode));

    return Result.ok(charge);
  }
);
// (userId: string, cents: number)
//   => AsyncResult<Charge, UserNotFound | NoPaymentMethod | PaymentDeclined>

// A synchronous body needs no different call.
const parseWebhookEvent = Result.registerExecution((raw: unknown) => {
  if (typeof raw !== "object" || raw === null) {
    return Result.err(new MalformedWebhook("body is not an object"));
  }
  return Result.ok(raw as StripeEvent);
});
// (raw: unknown) => Result<StripeEvent, MalformedWebhook>
```

> **It does not catch exceptions.** A `throw` inside the body still propagates, and an async body still rejects. That is deliberate: a throw is a bug, an error is an outcome. Use [`Result.try`](#try--run-it-now) when you want to convert one into the other — which is exactly what you do at the edge of an SDK that throws — or [`Result.fromThrowable`](#fromthrowable--convert-once-call-anywhere) to lift that SDK call once and stop thinking about it.

---

## Transforming

### `mapValue` — the workhorse

Runs on success, passes failures straight through. The callback returns a result, so it may introduce new errors, which are **added** to the union.

```ts
loadUser(userId) // AsyncResult<User, UserNotFound>
  .mapValue((user) => requirePlan(user, "pro")) // + SubscriptionRequired
  .mapValue((user) => loadWorkspace(user.orgId)) // + WorkspaceArchived
  .mapValue((ws) => Result.ok(serialise(ws))); // no new failures
// AsyncResult<WorkspaceDTO, UserNotFound | SubscriptionRequired | WorkspaceArchived>
```

A failure short-circuits the rest of the chain — later callbacks never run.

### `mapError`

Runs on failure, passes successes straight through. It sees the whole union at once, so the resulting error type is **replaced**, not narrowed:

```ts
// a public SDK method: collapse everything into one documented failure
const fetchInvoice = Result.registerExecution(async (id: string) =>
  loadInvoice(id)
    .mapError((e) => {
      logger.warn({ tag: e._tag }, "invoice lookup failed");
      return Result.err(new InvoiceUnavailable(id));
    })
    .getResult()
);
// AsyncResult<Invoice, InvoiceUnavailable>
```

To deal with specific error types and leave the rest alone, use `handleError`.

### `tap` / `tapError`

Side effects that do not change the value — logging, metrics, tracing. If the effect returns a promise, the chain turns asynchronous and **waits for it**.

```ts
placeOrder(cart)
  .tap((order) => metrics.increment("orders.placed", { plan: order.plan }))
  .tapError((e) =>
    logger.warn({ tag: e._tag, cartId: cart.id }, "checkout failed")
  )
  .tap(async (order) => await audit.record("order.created", order.id)); // awaited
```

---

## Handling errors

`handleError` takes one or more error **classes** followed by a handler, and removes exactly those classes from the union:

```ts
//  AsyncResult<Dashboard, UserNotFound | SubscriptionRequired | DatabaseUnavailable>
const dashboard = loadDashboard(userId)
  .handleError(UserNotFound, () => Result.ok(emptyDashboard))
  //  AsyncResult<Dashboard, SubscriptionRequired | DatabaseUnavailable>
  .handleError(SubscriptionRequired, (e) =>
    Result.ok(upsellDashboard(e.requiredPlan))
  )
  //  AsyncResult<Dashboard, DatabaseUnavailable>
  .handleError(DatabaseUnavailable, () =>
    Result.ok(staleDashboardFromCache(userId))
  );
//  AsyncResult<Dashboard, never>   ← nothing left to handle

const view = (await dashboard.getResult()).unwrap(); // safe, and the compiler knows it
```

The handler's parameter is narrowed to the classes you listed, so `e` is fully typed — including any data the error carries:

```ts
callExternalApi(request)
  .handleError(RateLimited, async (e) => {
    // e.retryAfterSeconds: number
    await sleep(e.retryAfterSeconds * 1000);
    return callExternalApi(request).getResult();
  })
  .handleError(PaymentDeclined, CardExpired, (e) => {
    // e: PaymentDeclined | CardExpired
    return Result.err(new CheckoutFailed(e._tag));
  });
```

A handler may also convert one error into another. The new error lands back in the union:

```ts
loadRow(id).handleError(DatabaseUnavailable, (e) =>
  Result.err(new ServiceDegraded(e))
);
// AsyncResult<Row, RowNotFound | ServiceDegraded>
```

Four properties worth knowing:

- **Matching is** `instanceof`, so handling a class also handles its subclasses.
- **A handler never sees its own output.** Converting `A` into `B` and then handling `B` later in the chain works exactly as written; there is no re-entry.
- **The handler runs at most once**, even if several of the listed classes match the same instance.
- **Every class you name must still be in the union.** Handling something the `Result` cannot be carrying is a compile error, not a step that silently never runs:

```ts
const dashboard = loadDashboard(userId).handleError(UserNotFound, () =>
  Result.ok(emptyDashboard)
);
// AsyncResult<Dashboard, SubscriptionRequired | DatabaseUnavailable>

dashboard.handleError(UserNotFound, handler); // ✗ already handled — not in the union
dashboard.handleError(ParseError, handler); //   ✗ never was in the union
Result.ok(1).handleError(UserNotFound, handler); // ✗ the union is `never`
```

A base class still names a union member that subclasses it, because matching is `instanceof` — `handleError(PaymentDeclined, …)` type-checks on a `Result` whose error is `CardExpired`. The one place the guard is stricter than the runtime is code that is generic over the error type: inside `<E>(r: Result<T, E>) => …` the compiler cannot see what `E` contains, so name a concrete union in the signature instead.

---

## Asynchronous chains

An asynchronous chain has a deliberately small surface: the five chaining methods, plus `getResult()`. Nothing reads a value — there is nothing to read until the chain settles.

| Member                                                                 | on `Result` | on an async chain                 |
| ---------------------------------------------------------------------- | ----------- | --------------------------------- |
| `mapValue`, `mapError`, `handleError`, `tap`, `tapError`               | yes         | yes — identical signature         |
| `getResult()`                                                          | yes         | yes — identical signature         |
| `match()`, `unwrap()`, `unwrapError()`, `unwrapOr()`, `unwrapOrElse()` | yes         | **no** — call `getResult()` first |
| `value`, `error`, `isOk`, `isErr`                                      | yes         | **no** — nothing to read yet      |
| `toAsync()`                                                            | yes         | **no** — already one              |

> Read the table as a **subset**: every member an asynchronous chain exposes also exists on `Result`, with the same signature. That is not a coincidence — it is what makes a [short-circuited step](#skipped-steps) safe, and it is asserted by a test.

A chain is **not** a thenable. Finish it with `getResult()`, or with a terminal — those resolve on their own.

```ts
const result = await loadUser(userId).getResult(); // Result<User, UserNotFound>

// the terminals live on the Result, so resolve first
const user = result.unwrapOr(guestUser);
const status = result.match({
  ok: () => 200 as const,
  err: () => 404 as const,
});

await loadUser(userId); // ✗ not thenable — hands back the chain
await loadUser(userId).unwrapOr(x); // ✗ a chain has no terminals
```

> Being a thenable would mean an `async` function returning a chain silently unwraps it, and a chain sitting in `Promise.all` resolves to something other than what you wrote. Keeping it a plain object makes `getResult()` the single, visible boundary between the chain and the promise world.

A whole pipeline stays flat — you never `await` in the middle of it:

```ts
const checkout = Result.registerExecution(async (cartId: string) =>
  loadCart(cartId)
    .mapValue((cart) => requireNonEmpty(cart)) // sync step
    .mapValue(async (cart) => reserveInventory(cart)) // async step
    .tap(async (cart) => await audit.record("inventory.reserved", cart.id))
    .mapValue((cart) => chargeSubscription(cart.userId, cart.totalCents))
    .handleError(RateLimited, async (e) => {
      await sleep(e.retryAfterSeconds * 1000);
      return Result.err(new CheckoutBusy());
    })
    .getResult()
);
```

`toAsync()` is the explicit lift, for when you want a chain to be asynchronous before any callback has made it so:

```ts
const resolveTenant = (req: { headers: Record<string, string | undefined> }) =>
  req.headers["x-tenant"]
    ? lookupTenant(String(req.headers["x-tenant"])) // already a chain
    : Result.err(new TenantMissing()).toAsync(); // lifted, so both branches match
```

> If the underlying promise **rejects** (something threw), the chain rejects too — it does not turn the rejection into an error branch. Wrap the throwing part in `Result.try` if you want that.

---

## Combining results

`Result.all` turns a tuple of results into a result of a tuple, failing with the **first error in argument order**. It accepts synchronous results, asynchronous chains, and bare promises of results, in any mix:

```ts
const page = await Result.all([
  loadUser(userId), // an async chain
  loadSubscription(userId), // an async chain
  loadRecentOrders(userId), // an async chain
  parseViewOptions(req.query), // a plain Result — no I/O
]).getResult();
// Result<
//   [User, Subscription, Order[], ViewOptions],
//   UserNotFound | SubscriptionMissing | DatabaseUnavailable | ValidationFailed
// >

const view = page.mapValue(([user, sub, orders, opts]) =>
  Result.ok(renderDashboard(user, sub, orders, opts))
);
```

If every member is synchronous you get a `Result` straight back, with no promise involved. If any member is asynchronous the whole call is, and every member runs **concurrently**.

Order is deterministic: the reported error is the first one in argument order, not the first to settle in time.

`all` stops at the first failure. To keep every failure, use `[collect](#collecting-every-error)`.

---

## Collecting every error

`Result.all` tells you _that_ something failed. `Result.collect` tells you **which** things failed. Same input, same tuple of values on success; on failure the error is a tuple the same length as the input, holding each member's error at its own index and `null` where that member succeeded.

```ts
const form = Result.collect([
  validateEmail(body.email), // Result<string, ValidationFailed>
  validatePassword(body.password), // Result<string, ValidationFailed>
  validateAge(body.age), // Result<number, ValidationFailed>
]);
// Result<
//   [string, string, number],
//   [ValidationFailed | null, ValidationFailed | null, ValidationFailed | null]
// >

const response = form.match({
  ok: ([email, password, age]) => ({
    status: 200,
    body: { email, password, age },
  }),
  err: (errors) => ({
    status: 422,
    body: {
      fields: errors.flatMap((e) =>
        e ? [{ field: e.field, reason: e.reason }] : []
      ),
    },
  }),
});
// → 422 { fields: [{ field: "password", reason: "too short" },
//                  { field: "age", reason: "must be 18 or older" }] }
```

The index is the point: you know _which_ field failed, not merely that one did.

|                          | `all`                    | `collect`                          |
| ------------------------ | ------------------------ | ---------------------------------- | ----- |
| Value on success         | tuple of values          | tuple of values (identical)        |
| Error on failure         | the first error          | a tuple, `null` where it succeeded |
| Error type               | a union of tagged errors | a tuple of `error                  | null` |
| Works with `handleError` | yes                      | **no** — the error is a tuple      |
| Reach for it when        | any failure means stop   | you must report every failure      |

> Because the error is a tuple rather than a tagged error, `handleError()` cannot match on it — no error class is in that union, so the call does not compile. Read a collected failure with `match()` or `error`.

```ts
const form = await Result.collect([
  validateEmailFormat(body.email), // sync
  ensureEmailIsFree(body.email), // async: one query
  ensureUsernameIsFree(body.handle), // async: one query, runs alongside
]).getResult();
```

It follows the same dispatch rule as everything else: synchronous members give a `Result` straight back, and any asynchronous member makes the whole call asynchronous with the members running concurrently.

---

## Getting the value out

The terminals live on `Result` only. An asynchronous chain has none — you call `getResult()` first, and use them on the `Result` that comes back. That is deliberate: it is what makes a [short-circuited step](#skipped-steps) safe.

```ts
const settled = await loadUser(userId).getResult();
settled.match({ ok: (u) => u.name, err: (e) => e._tag }); // and every other terminal
```

| Method                   | Returns                 | On the other branch            |
| ------------------------ | ----------------------- | ------------------------------ | ----------------------------- | ----------- |
| `match({ ok, err })`     | `A                      | B`                             | runs the other branch         |
| `unwrap()`               | `T`                     | **throws** `ResultUnwrapError` |
| `unwrapError()`          | `E`                     | **throws** `ResultUnwrapError` |
| `unwrapOr(fallback)`     | `T                      | D`                             | returns `fallback`            |
| `unwrapOrElse((e) => …)` | `T                      | D`                             | returns the computed fallback |
| `getResult()`            | `Promise<Result<T, E>>` | —                              |
| `isOk` / `isErr`         | `boolean`               | —                              |
| `value` / `error`        | `T                      | undefined`/`E                  | undefined`                    | `undefined` |

`match` is the exhaustive one — you cannot forget a branch:

```ts
// handleError collapses the union to the one failure this boundary reports…
const charge = await chargeSubscription(userId, 4900)
  .handleError(UserNotFound, () =>
    Result.err(new CheckoutFailed(404, "no such user"))
  )
  .handleError(NoPaymentMethod, () =>
    Result.err(new CheckoutFailed(402, "add a card first"))
  )
  .handleError(PaymentDeclined, (e) =>
    Result.err(new CheckoutFailed(402, `declined: ${e.failureCode}`))
  )
  .getResult(); // Result<Charge, CheckoutFailed>

// …and match reads both branches, with nothing left to dispatch on.
const response = charge.match({
  ok: (charge) => ({ status: 200, body: { receiptUrl: charge.receiptUrl } }),
  err: (e) => ({ status: e.status, body: { error: e.reason } }),
});
```

`unwrap()` is the only place this library throws on purpose. Once the union has been narrowed to `never` it is provably safe, which makes it the natural end of a fully-handled chain — and a reasonable thing to do at boot, where a failure should stop the process anyway.

```ts
// application startup: if the config is wrong, do not start.
// loadConfig reads process.env — no I/O, so this whole chain is synchronous.
const config = loadConfig(process.env)
  .handleError(MissingEnvVar, (e) =>
    Result.err(new FatalMisconfiguration(e.name))
  )
  .unwrapOrElse((e) => {
    logger.fatal({ tag: e._tag }, "invalid configuration");
    process.exit(1);
  });
```

Reaching for it mid-chain throws away the guarantee you adopted the library for.

The thrown `ResultUnwrapError` carries the original failure on `.taggedError`, so nothing is lost:

```ts
try {
  (await loadUser("u_missing").getResult()).unwrap();
} catch (thrown) {
  if (thrown instanceof ResultUnwrapError) {
    thrown.taggedError; // the UserNotFound instance, with its userId
    thrown.message; // 'Called unwrap() on an error Result (UserNotFound)'
  }
}
```

`value` and `error` are typed as `T | undefined` / `E | undefined` because a getter cannot narrow `this`. If you want the compiler to prove which branch you are on, use `match`.

---

## Bridging code that throws

This is the boundary between the throwing world — every SDK you did not write — and the typed one. Two entry points cross it: `try` runs the throwing call now, `fromThrowable` hands you a function that does.

### try — run it now

`Result.try` runs a function and converts anything it throws into a tagged error — and, like everything else, it follows the dispatch rule:

```ts
// a third-party SDK that rejects on network and HTTP errors alike
const charge = await Result.try(
  () => stripe.charges.create({ amount, customer }),
  (thrown) => new PaymentGatewayError(String(thrown))
).getResult();
// Result<Charge, PaymentGatewayError>

// parsing a webhook body — synchronous, so a plain Result comes back
const event = Result.try(
  () => JSON.parse(rawBody) as StripeEvent,
  (thrown) => new MalformedWebhook(String(thrown))
);
// Result<StripeEvent, MalformedWebhook>
```

On the asynchronous path it catches both a synchronous throw and a rejected promise.

`onThrow` receives the thrown value as `unknown` — JavaScript does not guarantee it is an `Error`, and pretending otherwise is how `e.message` becomes `undefined` in production.

### fromThrowable — convert once, call anywhere

`Result.fromThrowable` is the same conversion, lifted: it **wraps** the function instead of running it. The throwing call and the failure it becomes are named one time, at the boundary; every call site afterwards is ordinary. Arguments and the dispatch rule pass straight through.

```ts
const parseJson = Result.fromThrowable(
  (raw: string) => JSON.parse(raw) as StripeEvent,
  (thrown) => new MalformedWebhook(String(thrown))
);
// (raw: string) => Result<StripeEvent, MalformedWebhook>

parseJson(rawBody).mapValue((event) => handle(event)); // no try in sight

const charge = Result.fromThrowable(
  (amount: number, customer: string) =>
    stripe.charges.create({ amount, customer }),
  (thrown) => new PaymentGatewayError(String(thrown))
);
// (amount: number, customer: string) => AsyncResult<Charge, PaymentGatewayError>
```

> **Annotate what the throwing call returns.** Handing over a function typed `any` — `Result.fromThrowable(JSON.parse, …)` — leaves the compiler no way to tell a promise from a value, so it errs towards the asynchronous type. That is the safe direction, but not the one you want for `JSON.parse`: wrap it in an arrow with a return type, as above.

The mirror direction — going back to exceptions at the edge of your typed core — is `unwrap()`, or an explicit `throw` inside `match`.

---

## Recipes

### An HTTP handler

```ts
app.get("/api/orders/:id", async (req, res) => {
  const settled = await loadOrder(req.params.id, req.user.id)
    .mapValue((order) => Result.ok({ status: 200, headers: {}, body: order }))
    .handleError(OrderNotFound, () =>
      Result.ok({ status: 404, headers: {}, body: { error: "not found" } })
    )
    .handleError(NotYourOrder, () =>
      Result.ok({ status: 403, headers: {}, body: { error: "forbidden" } })
    )
    .handleError(RateLimited, (e) =>
      Result.ok({
        status: 429,
        headers: { "Retry-After": String(e.retryAfterSeconds) },
        body: { error: "slow down" },
      })
    )
    .handleError(DatabaseUnavailable, (e) => {
      logger.error({ err: e }, "order lookup failed"); // a real Error: has a stack
      return Result.ok({
        status: 503,
        headers: {},
        body: { error: "try again shortly" },
      });
    })
    .getResult(); // Result<Response, never>

  const response = settled.unwrap(); // safe: nothing is left in the union
  res.status(response.status).set(response.headers).json(response.body);
});
```

Each handler receives exactly the classes it named — `e.retryAfterSeconds` is available only where it exists — and the union arriving at `never` is the proof that every failure got a status code.

### Exhaustiveness at the boundary

Pin the handled chain to `never`. A chain that still carries a failure is not assignable to it, so a fourth failure upstream breaks this line rather than production:

```ts
const respond = (
  loaded: Result<Order, OrderNotFound | NotYourOrder | RateLimited>
) => {
  const handled: Result<HttpResponse, never> = loaded
    .mapValue((order) => Result.ok(ok200(order)))
    .handleError(OrderNotFound, () => Result.ok(status(404, "not found")))
    .handleError(NotYourOrder, () => Result.ok(status(403, "forbidden")))
    .handleError(RateLimited, (e) => Result.ok(retryAfter(e.retryAfterSeconds)));

  return handled.unwrap();
};
```

### Fallback chain

```ts
const avatar = (
  await fromCache(userId)
    .handleError(CacheMiss, () => fromDatabase(userId))
    .handleError(NotStored, () => fromGravatar(userId))
    .tapError((e) => metrics.increment("avatar.miss", { tag: e._tag }))
    .getResult()
).unwrapOr(defaultAvatarUrl);
```

### Keeping layers honest

Each layer handles what it can and re-tags what it cannot, so the error union at the top is a list of things the caller must actually decide about:

```ts
// repository — infrastructure vocabulary only
const findOrderRow = Result.registerExecution(async (id: string) => { ... });
// AsyncResult<OrderRow, RowNotFound | DatabaseUnavailable>

// service — retires infrastructure detail, adds domain meaning
const loadOrder = Result.registerExecution(async (id: string, viewerId: string) =>
  findOrderRow(id)
    .handleError(RowNotFound, () => Result.err(new OrderNotFound(id)))
    .mapValue((row) =>
      row.userId === viewerId ? Result.ok(row) : Result.err(new NotYourOrder()),
    )
    .mapValue((row) => Result.ok(toDomain(row)))
    .getResult(),
);
// AsyncResult<Order, OrderNotFound | NotYourOrder | DatabaseUnavailable | InvalidRow>

// transport — the union above is the exact list of cases the handler must map
```

---

## TypeScript notes

### How the union moves

| Operation                      | Effect on the error union                    |
| ------------------------------ | -------------------------------------------- |
| `mapValue(fn)`                 | adds whatever `fn` can fail with             |
| `mapError(fn)`                 | **replaces** the union entirely              |
| `handleError(A, B, fn)`        | removes `A` and `B`, adds `fn`'s errors      |
| `tap` / `tapError`             | unchanged                                    |
| `Result.all([...])`            | the union of every member                    |
| `Result.registerExecution(fn)` | collapses a union of results into one result |

### Naming an asynchronous chain

The asynchronous class is not exported, so you never write it by hand. When you do need to name one, infer it from a function that produces one:

```ts
const loadOrder = Result.registerExecution(async (id: string) => { ... });

type OrderChain = ReturnType<typeof loadOrder>;
type OrderResult = Awaited<ReturnType<OrderChain["getResult"]>>; // Result<Order, …>

// middleware that works on any chain this function returns
const instrumented = (chain: OrderChain, route: string) =>
  chain
    .tap(() => metrics.increment("order.loaded", { route }))
    .tapError((e) => metrics.increment("order.failed", { route, tag: e._tag }));
```

In practice this comes up rarely: the chain is usually built and consumed in one expression, and `await` hands you back an ordinary `Result`, which _is_ exported and nameable.

---

## API reference

### `Result` — statics

| Signature                         | Description                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ok(): Result<void, never>`       | Success carrying nothing.                                                                                 |
| `ok<T>(value): Result<T, never>`  | Success carrying `value`.                                                                                 |
| `empty(): Result<null, never>`    | Success carrying `null`.                                                                                  |
| `err<E>(error): Result<never, E>` | Failure carrying a tagged error.                                                                          |
| `try(fn, onThrow)`                | Runs `fn`, converting a throw — or a rejection — into a tagged error. Async when `fn` returns a promise.  |
| `fromThrowable(fn, onThrow)`      | The same conversion, wrapped instead of run: returns `(...args) => Result<T, E>`.                         |
| `registerExecution(fn)`           | Collapses a union of results into a result of unions. Async when the body is.                             |
| `all(results)`                    | Tuple of results → result of a tuple. First error wins. Async if any member is; members run concurrently. |
| `collect(results)`                | Same values, but the error is a **tuple** of every member's error with `null` where it succeeded.         |

### `Result` — instance

The chaining methods and terminals below exist on an asynchronous chain too, under the same names with the same meanings — the async one just returns promises. The accessors and `toAsync()` are synchronous-only; `getResult()` is chain-only. There is no `then`: a chain is not thenable.

| Signature                          | Description                                                           |
| ---------------------------------- | --------------------------------------------------------------------- | ------------- | ---------- |
| `isOk` / `isErr`                   | `boolean`                                                             |
| `value` / `error`                  | `T                                                                    | undefined`/`E | undefined` |
| `mapValue(fn)`                     | Transform the value; failures pass through. Errors accumulate.        |
| `mapError(fn)`                     | Transform the error; successes pass through. Errors are replaced.     |
| `handleError(...classes, handler)` | Handle specific classes and every descendant; subtracts them from the union. |
| `tap(fn)` / `tapError(fn)`         | Side effect; returns the chain unchanged. An async effect is awaited. |
| `match({ ok, err })`               | Collapse both branches into one value.                                |
| `unwrap()` / `unwrapError()`       | Extract, or throw `ResultUnwrapError`.                                |
| `unwrapOr(d)` / `unwrapOrElse(fn)` | Extract with a fallback.                                              |
| `toAsync()`                        | Lift a synchronous result into an asynchronous chain. `Result` only.  |
| `getResult()`                      | Resolve an asynchronous chain to a plain `Result`. Chain only.        |

### Error base classes

| Signature                | Description                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `Tagged(tag)`            | Abstract base stamping a literal `_tag`. Each call returns a distinct class.                                          |
| `Tagged(tag, Parent)`    | The same, as a member of `Parent`'s family: `_tag` becomes `"Parent.tag"` and `handleError(Parent)` handles it.       |
| `TaggedError(tag)`       | The same as `Tagged(tag)`, but instances are real `Error`s with `message`, `stack` and `name === tag`.                |
| `TaggedError(tag, Parent)` | A member of an `Error` family; `name` follows the composed path. `Parent` must already be an `Error` family.        |
| `ResultUnwrapError`      | Thrown by `unwrap()` / `unwrapError()`. Carries the original error on `.taggedError`.                                 |

### Branding values

| Signature                | Description                                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `Branded<T, Name>`       | The base type `T` with a compile-time-only label. A raw `T` is not assignable to it; it is assignable to `T`.          |
| `brand(name)`            | A constructor for `Branded<string, name>`. Identity at runtime. Base type via `brand<"tag", T>(name)`.                 |
| `brand(name, is)`        | The same, checked: the constructor throws `InvalidBrand`, plus `is()` and `safe()`. Base type inferred from `is`.       |
| `BrandOf<typeof X>`      | The type a `brand()` factory produces, so the name is written once.                                                   |
| `Brand<T, Name>`         | The shape of an unchecked factory: callable, plus `brandName`. Use it to type one you are passed.                     |
| `CheckedBrand<T, Name>`  | The same with the predicate behind it: adds `is()` and `safe()`.                                                      |
| `InvalidBrand`           | Tagged `Error` a checked brand reports. Carries `brandName` and the refused `value`.                                  |

A tag may not contain `.` — the factory composes the path, and a hand-written dot would claim a lineage `instanceof` does not back.

---

## Comparison

|                                  | this                 | neverthrow          | Effect               |
| -------------------------------- | -------------------- | ------------------- | -------------------- |
| Error union in the type          | yes                  | yes                 | yes                  |
| Handle by error class            | **yes, subtractive** | manual              | yes, via tags        |
| Sync and async                   | **one API**          | two types, two APIs | one API              |
| Runtime to install               | none                 | none                | yes                  |
| Generator syntax                 | no                   | no                  | yes                  |
| Dependency injection             | no                   | no                  | yes                  |
| Concurrency, retries, scheduling | no                   | no                  | yes                  |
| Bundle size                      | **1.4 KB** min+gz    | comparable          | substantially larger |
| Names to import                  | **6**, plus 4 types  | a dozen or so       | many                 |

Pick Effect when you want the whole platform. Pick this when you want typed errors and nothing else in the way.

---

MIT © Dmytro Mykhailiuk

import { type BrandOf, InvalidBrand, Result, Tagged, brand } from "../src";

class NotFoundError extends Tagged("NotFoundError") {}
class InvalidIdError extends Tagged("InvalidIdError") {}

const db = new Set([1, 2, 3]);

const getFromDb = Result.registerExecution((id: number) => {
  if (id <= 0) {
    return Result.err(new InvalidIdError());
  }

  if (!db.has(id)) {
    return Result.err(new NotFoundError());
  }

  return Result.ok(id);
});

const res1 = getFromDb(2)
  .mapValue((value) => Result.ok(value ** 2))
  .mapError(() => Result.empty());

const res2 = getFromDb(-1)
  .mapValue((value) => Result.ok(value ** 2))
  .mapError(() => Result.empty());

const res3 = getFromDb(-1).mapValue((value) => Result.ok(value ** 2));

const res4 = Result.err(new NotFoundError()).mapValue(() => Promise.resolve(Result.ok(2)));

const res5 = Result.all([Result.ok(true), Result.ok(5), Result.ok("4")]);

// A family: the second argument makes each class a member of the one above it.
// No hand-written discriminant — the tag carries the lineage.
class RundomBaseError extends Tagged("RundomBaseError") {}
class Random1Error extends Tagged("Random1Error", RundomBaseError) {}
class Random2Error extends Tagged("Random2Error", RundomBaseError) {}
class Random1DeepError extends Tagged("Deep", Random1Error) {}

const resTest = Result.registerExecution(() => {
  const rundom = 0;

  if (rundom > 0.5) {
    return Result.ok(rundom);
  }
  if (rundom > 0.3) {
    return Result.err(new Random1Error());
  }
  if (rundom > 0.15) {
    return Result.err(new Random2Error());
  }
  return Result.err(new Random1DeepError());
})();
// Result<number, Random1Error | Random2Error | Random1DeepError>  ← all three survive

// The root handles the whole family, at any depth.
const resTest2 = resTest.handleError(RundomBaseError, () => Result.ok(1));

// @ts-expect-error nothing left to handle — the error union is already `never`
resTest2.handleError(Random2Error, () => Result.ok(true));

// One branch at a time: handling Random1Error leaves Random2Error behind.
const resTest3 = resTest
  .handleError(Random1Error, () => Result.ok(1))
  .handleError(Random2Error, () => Result.ok(2));

resTest.handleError(Random1DeepError, () => Result.ok(1));

// ── brands: two strings that must not be interchangeable ────────────────
const UserId = brand("userId");
type UserId = BrandOf<typeof UserId>;

const OrderId = brand("orderId");

const Email = brand("email", (value: string) => value.includes("@"));

const loadUser = (id: UserId) => `loaded ${id}`;

loadUser(UserId("u_1"));
// @ts-expect-error a raw string is not a UserId
loadUser("u_1");
// @ts-expect-error and neither is another brand
loadUser(OrderId("o_1"));

// A checked brand validates; safe() keeps the failure inside a Result.
const emailResult = Email.safe("not-an-email")
  .mapValue((email) => Result.ok(`welcome ${email}`))
  .handleError(InvalidBrand, (e) => Result.ok(`rejected ${String(e.value)}`));

(async () => {
  console.log("res1Value", res1.value);
  console.log("res2Value", res2.value);
  console.log("res3", res3.isErr, res3.value, res3.error);
  const res4Sync = await res4.getResult();
  console.log(res4 instanceof Result, "res4", res4Sync.isErr, res4Sync.error);
  const res5Sync = await res5.getResult();
  console.log(res4 instanceof Result, "res5", res5Sync.isOk, res5Sync.value);
  console.log("resTest", resTest.isOk, resTest.error?._tag);
  console.log("resTest2", resTest2.isOk, resTest2.value);
  console.log("resTest3", resTest3.isOk, resTest3.value);
  console.log("brand", loadUser(UserId("u_1")), emailResult.value);
  console.log("family tags", [
    new RundomBaseError()._tag,
    new Random1Error()._tag,
    new Random1DeepError()._tag,
    new Random1DeepError() instanceof RundomBaseError,
  ]);
})();

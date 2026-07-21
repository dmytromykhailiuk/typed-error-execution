import { Result, Tagged } from "../src";

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

(async () => {
  console.log("res1Value", res1.value);
  console.log("res2Value", res2.value);
  console.log("res3", res3.isErr, res3.value, res3.error);
  const res4Sync = await res4.getResult();
  console.log(res4 instanceof Result, "res4", res4Sync.isErr, res4Sync.error);
})();

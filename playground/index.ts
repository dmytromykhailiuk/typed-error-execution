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

const res5 = Result.all([Result.ok(true), Result.ok(5), Result.ok("4")]);

class Random1Error extends Tagged("Random1Error") {}
class Random2Error extends Tagged("Random2Error") {}

const resTest = Result.registerExecution(() => {
  const rundom = Math.random();

  if (rundom > 0.5) {
    return Result.ok(rundom);
  } else if (rundom > 0.2) {
    return Result.err(new Random1Error());
  } else {
    return Result.err(new Random2Error());
  }
})();

const resTest2 = resTest.handleError(Random1Error, Random2Error, () => Result.ok(1));

const resTest3 = resTest2.mapError(() => Result.ok(true));

resTest.handleError(Random1Error, () => Result.ok(1));

(async () => {
  console.log("res1Value", res1.value);
  console.log("res2Value", res2.value);
  console.log("res3", res3.isErr, res3.value, res3.error);
  const res4Sync = await res4.getResult();
  console.log(res4 instanceof Result, "res4", res4Sync.isErr, res4Sync.error);
  const res5Sync = await res5.getResult();
  console.log(res4 instanceof Result, "res5", res5Sync.isOk, res5Sync.value);
  console.log("resTest", resTest.isOk, resTest.value);
  console.log("resTest2", resTest2.isOk, resTest2.value);
  console.log("resTest3", resTest3.isOk, resTest3.value);
})();

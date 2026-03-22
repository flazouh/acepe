# Neverthrow Error Handling

**CRITICAL**: All async operations MUST use `ResultAsync<T, E>` from neverthrow, NEVER use `Promise<Result<T, E>>`.

## Core Rules

- **Async Methods**: Return `ResultAsync<T, E>`, never `Promise<Result<T, E>>`
- **Promise Conversion**: Use `ResultAsync.fromPromise(promise, errorMapper)`
- **No Promise.resolve().then()**: Never wrap synchronous operations in `Promise.resolve().then()` - use direct ResultAsync construction
- **Chaining**: Use `.map()`, `.andThen()`, `.mapErr()`, `.orElse()` for operations
- **No try-catch**: Never use try-catch blocks - use ResultAsync error handling instead
- **Error Transformation**: Use `.mapErr()` to add context, `.orElse()` for fallbacks
- **Unwrapping with match**: Use **positional** callbacks: `match(okCallback, errorCallback)`. neverthrow does not accept an object `{ ok, err }`.

## Unwrapping with match

Use `match` at the end of a chain when you need to turn a `Result` or `ResultAsync` into a single value or response (e.g. in API handlers). The API is **two positional arguments**, not an object.

```typescript
// ✅ Correct: positional (okCallback, errorCallback)
result.match(
  (value) => doSomething(value),
  (error) => handleError(error)
);

// With ResultAsync, match returns a Promise; handlers may be async
await resultAsync.match(
  async (value) => json(value),
  (e) => { throw error(500, e.message); }
);

// ❌ Wrong: object form — neverthrow will treat the object as the ok callback and throw "ok is not a function"
result.match({ ok: (v) => v, err: (e) => e });
```

## Essential Patterns

```typescript
// ✅ Correct: Pure ResultAsync chaining
loadUser(id: string): ResultAsync<User, Error> {
  return ResultAsync.fromPromise(fetchUser(id), (e) => new Error(`API failed: ${e}`))
    .map(user => ({ ...user, loadedAt: Date.now() }))
    .andThen(validateUser)
    .mapErr(e => new Error(`User loading failed: ${e.message}`));
}

// ✅ Correct: Sequential operations
createAndSaveUser(data: UserData): ResultAsync<User, Error> {
  return validateUserData(data)
    .andThen(validData => createUser(validData))
    .andThen(user => saveUser(user));
}

// ✅ Correct: Error recovery with orElse
getUserWithFallback(id: string): ResultAsync<User, Error> {
  return loadUser(id)
    .orElse(() => loadUserFromCache(id))
    .orElse(() => ResultAsync.fromPromise(createDefaultUser(id)));
}

// ❌ Wrong: Don't mix with try-catch
loadData(): ResultAsync<Data[], Error> {
  try {
    const data = await fetchData();
    return ok(data.items);
  } catch (error) {
    return err(new Error(String(error)));
  }
}

// ❌ Wrong: Don't return Promise<Result>
async loadData(): Promise<Result<Data[], Error>> {
  const data = await fetchData();
  return ok(data.items);
}

// ❌ Wrong: Don't wrap synchronous operations in Promise.resolve().then()
saveData(data: Data): ResultAsync<Data, Error> {
  return ResultAsync.fromPromise(
    Promise.resolve().then(() => {
      validateData(data);
      persistData(data);
      return data;
    }),
    (error) => new Error(`Save failed: ${error.message}`)
  );
}
```

## Advanced Patterns

```typescript
// ✅ Correct: Combine multiple ResultAsync operations
combineResults(): ResultAsync<[User, Settings], Error> {
  return ResultAsync.combine([
    loadUser('123'),
    loadSettings('456')
  ]);
}

// ✅ Correct: Synchronous operations returning ResultAsync
saveData(data: Data): ResultAsync<Data, Error> {
  validateData(data);
  persistData(data);
  return okAsync(data);
}

// ✅ Correct: Transform errors with context
processWithContext(): ResultAsync<ProcessedData, Error> {
  return loadRawData()
    .mapErr(e => new Error(`Data loading failed: ${e.message}`))
    .andThen(processData)
    .mapErr(e => new Error(`Data processing failed: ${e.message}`));
}

// ✅ Correct: Conditional logic without throwing
conditionalLogic(flag: boolean): ResultAsync<string, Error> {
  return flag
    ? ResultAsync.ok('success')
    : ResultAsync.err(new Error('flag was false'));
}
```

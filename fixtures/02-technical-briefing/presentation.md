:::slide-layout{intro}
# Reliable by Design

An engineering briefing on making failure boring.

---

# The system in one sentence

Every request should be **traceable**, every retry should be **bounded**, and every failure should be **recoverable**.

```text
request -> validate -> execute -> record -> respond
             |          |
             +----------+
                retry safely
```

---

# Three invariants

## 1. Idempotency

Repeating a request must not duplicate its effect.

## 2. Visibility

Errors need an owner, a timestamp, and enough context to act.

## 3. Graceful degradation

When a dependency fails, preserve the user's work first.

---

# The failure path

```ts
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; retryable: boolean };

function retryable(result: Result<unknown>): boolean {
  return !result.ok && result.retryable;
}
```

---

# What we measure

- p95 request latency below **400 ms**
- zero silent data loss
- recovery available within **one action**
- retries capped at **three attempts**

---

# Shipping checklist

- [ ] Logs identify the operation
- [ ] Tests cover the unhappy path
- [ ] UI explains what the user can do next
- [ ] Rollback is documented

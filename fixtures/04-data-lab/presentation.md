:::slide-layout{intro}
# Data Lab

A compact tour through a small but honest dataset.

---

# The question

Does response time predict whether a customer returns?

We tracked 240 support conversations over four weeks and grouped them by first-response time.

---

# The signal

| First response | Return within 30 days |
| --- | ---: |
| Under 10 minutes | 78% |
| 10-60 minutes | 64% |
| 1-4 hours | 49% |
| More than 4 hours | 31% |

Correlation is not causation, but the gradient is strong enough to guide an experiment.

---

# The experiment

```python
groups = {
    "fast": conversations[minutes < 10],
    "standard": conversations[(minutes >= 10) & (minutes <= 60)],
}

return_rate = {
    name: group.returned.mean()
    for name, group in groups.items()
}
```

---

# What we still do not know

- Did urgent customers receive faster replies for another reason?
- Does response quality matter more than response speed?
- Does the effect hold for every customer segment?

---

# Next measurement

Run a controlled routing test for two weeks.

Success means faster first response **without** lower resolution quality.

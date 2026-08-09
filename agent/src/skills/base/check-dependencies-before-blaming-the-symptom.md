---
name: check-dependencies-before-blaming-the-symptom
description: A service showing errors is often failing because of something upstream or downstream, not itself — check neighbors before concluding.
origin: base
confidence: 0.85
times_applied: 0
---

In a service-oriented system, the service that shows visible symptoms (errors in its own
logs, elevated latency) is frequently not where the actual fault lives. Before concluding
"service X is broken," look at what X calls and what calls X:

- If X's own resource metrics (its own CPU, memory, GC) look normal but its error rate is up,
  suspect a downstream dependency it talks to is the real source.
- If X's latency is up but its error rate is flat, suspect a downstream call is slow rather
  than X itself doing more work.
- Pull a trace that includes X and look at the spans around it — a failing or slow child span
  is stronger evidence of root cause than X's own logs alone.

Naming the wrong service as the cause wastes investigation time and produces a less useful
incident. When in doubt, say what you ruled out, not just what you suspect.

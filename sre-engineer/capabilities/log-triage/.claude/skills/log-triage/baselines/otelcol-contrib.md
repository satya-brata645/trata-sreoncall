---
name: otelcol-contrib
observed_windows: 1
confidence: low
last_revised: 2026-08-09T13:43:00Z
---

## What I have actually seen

Window 1 — 2026-08-09 ~13:33–13:43 UTC. This is the observability pipeline itself, not an
application service. I baseline it because if it degrades I stop being able to see anything
else, and I would rather find that myself than discover it mid-incident.

An unfiltered Loki sweep for error-ish text across all services in 30 minutes returned only
three streams, two of them this collector's:

```
{service_name=~".+"} |~ `(?i)(error|exception|fail|panic|fatal)`
  otelcol-contrib  "Error scraping metrics"                             severity: error
  otelcol-contrib  "Exporting failed. Will retry the request after interval."  severity: info
  opentelemetry-demo/ad  "Transport failed"                             severity: INFO
```

The scrape error, in full:

```
{"body":"Error scraping metrics","severity":"error","attributes":{
  "code.file.path":"go.opentelemetry.io/collector/scraper/scraperhelper@v0.157.0/obs_metrics.go",
  "code.function.name":"go.opentelemetry.io/collector/scraper/scraperhelper.wrapObsMetrics.func1",
  "code.line.number":61, "scraper":"process"}}
```

Frequency:

```
sum(count_over_time({service_name="otelcol-contrib"} |= `Error scraping metrics` [10m]))
  13:10 -> 1 · 13:30 -> 1
```

## What I consider normal, and why

One scrape error per 10 minutes, `scraper="process"`, is the current steady state. That is the
**hostmetrics process scraper** failing to read host process information — a container
permissions limitation on `host_name=lgtm-sreoncall` — and it is not the application telemetry
path.

I verified that rather than assuming it: traces, spanmetrics and logs from every service were
all queried successfully in this same window, across Mimir, Loki and Tempo. So the honest
verdict is **degraded in a narrow, known way (host process metrics only), app telemetry
unaffected**. Worth recording, not worth an alert.

`"Exporting failed. Will retry"` at `severity: info` is the exporter's normal retry chatter,
not a delivery failure — the data arrived, since I queried it.

## What would make me suspicious

A different `scraper` value failing, or the scrape errors climbing well above the ~1/10m
cadence. More seriously: `"Exporting failed"` escalating from `info` to `error`, or any sign of
queue/drop behaviour — that would mean telemetry is being lost rather than retried, and every
other judgment I make would be resting on incomplete data.

The real thing to watch is silence: whole services disappearing from
`sum by (service_name)(rate(traces_span_metrics_calls_total[10m]))`, which would be a pipeline
failure masquerading as a quiet system.

## What would NOT

**`severity: error` in a collector log is not automatically an incident** — the severity field
here describes the scraper's own failed operation, not user impact. Nothing a user does
depends on host process metrics.

More important, and the reason this file exists: **never respond to noise from this component
by narrowing what I collect.** If a check keeps surfacing something inconvenient, the answer is
to understand it, never to filter it away. Muting or narrowing telemetry to quiet a signal is
blinding myself, and it is not on the list of options at all.

Related coverage gaps found the same day, both of which produce empty results that look like
answers: Loki carries only 13 `service_name` streams (`frontend`, `frontend-web`, `flagd`,
`image-provider` ship **no logs at all**), and spanmetrics carries **no
`http_response_status_code` label** on this stack.

# Dashboards (disco)

Disco is the generated-dashboard system: `packages/disco-core/` is the engine,
`components/disco/` renders it, `artifacts/` holds what a producer dropped and
what an author pinned. An app hands it JSON and a question and gets back a live,
editable dashboard; a model participates, but only where judgement is required.
The per-file comments are the primary source; this records the invariants that
span more than one file.

## 1. The correctness model

Two rules make the whole thing trustworthy, and both are enforced in code rather
than asked for in a prompt.

**Blocks bind, they never carry data.** Every block points at a *frame id*. The
numbers come out of the algebra, which is deterministic code in the data plane.
There is no field anywhere in the spec schema where a figure can be written, so
**the agent cannot invent one**. It composes a question; the engine answers it.

**The vocabulary is closed.** `BlockSchema` is a discriminated union of thirteen
kinds. A kind the renderer does not know is a *validation failure at generation
time*, not a blank card at runtime. Same for derivations, aggregates,
comparators and formats: every one is a `z.enum`, so "plausible JSON that means
nothing" fails at the gate rather than three layers downstream.

`types.ts` states the split the rest of the code obeys: a **data plane**
(`types.ts`, `profile.ts`, `algebra.ts`) that is deterministic and consults no
model, and a **view plane** (`spec.ts`) that the agent writes and that binds to
the data plane by id. End to end:

```
 JSON document
      │  profile.ts        findTables → flattenRow → profileField
      ▼
 DatasetProfile ──► digest.ts ──► the ONLY thing an agent ever reads
      │                              │
      │  recommend.ts                │ composes / patches
      ▼                              ▼
 ranked candidates ───────────►  DashboardSpec
                                     │  validate.ts + rules.ts   (the gate)
                                     │  resolve.ts               (late binding)
                                     ▼
                              algebra.ts ──► Map<id, Frame>
                                     │
                            layout.ts (rect ⇒ placement)
                                     ▼
                          components/disco/surface.tsx
```

## 2. The spec — `spec.ts`

`disco/v1`. A Zod schema, and the contract between the agent and the renderer.
Ids are `^[a-z][a-z0-9_]*$` everywhere, which is what lets generated ids
(`ctl__raw`, `trend_bucketed`) stay inside the same namespace as authored ones.

### The derivation DAG

Derivations name their input by id (`from`), so they form a DAG rather than a
list. `runPipeline` topologically resolves them; a cycle or an unreachable node
is an error, not a silent skip. Ten ops, all of them closed:

| op | what it does | notes that matter |
|---|---|---|
| `filter` | rows matching every predicate | ≥1 predicate required |
| `groupBy` | `by[]` keys, `agg` map of column → aggregate | group values read off the first member, so the original type survives |
| `timeBucket` | floor a temporal field to a `unit`, aggregate per bucket | `fillGaps` (below); optional `by[]` for split series |
| `topK` | top `k` rows by `metric` | `other: true` rolls the tail into one `Other (n)` row |
| `bin` | histogram, 2–100 bins | emits `bin`, `binStart`, `binEnd`, `count` |
| `derive` | one computed column | two operands, one operator — no expression language, no `eval` |
| `window` | `rollingAvg` \| `cumSum` \| `delta` | a leading partial window emits `null`, never an understated average |
| `sort` | numeric/temporal, else lexical | |
| `limit` | first `n` rows | |
| `downsample` | LTTB to `points` | 50–5 000 |

`derive`'s operator set is `add`, `sub`, `mul`, `div`, `pctOf`, `pctChange`.
Time units are `hour | day | week | month | quarter | year`.

### The vocabularies

- **Aggregates** — `sum`, `avg`, `min`, `max`, `count`, `countDistinct`,
  `median`, `p95`, `first`, `last`.
- **Comparators** — `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`,
  `contains`, `isNull`, `notNull`. A predicate is `{ field, op, value? }`.
- **Formats** — `number`, `compact`, `usd`, `percent`, `bytes`, `ms`,
  `duration`. Implemented once in `format.ts` so a tile and its tooltip cannot
  disagree, and pinned to `en-US` with explicit `trailingZeroDisplay` because
  Node and Chrome ship different ICU defaults — the difference surfaces as a
  React hydration mismatch on every server-rendered figure.

### Block kinds

`kpi`, `timeseries`, `bar`, `pie`, `scatter`, `histogram`, `heatmap`, `table`,
`funnel`, `radar`, `radial`, `callout`, `text`. Each carries `span` (2–12 of a
12-column grid), an optional `title`/`subtitle`, and `reason` — the composer's
one-line argument for the block, shown in the spec inspector.

The last five exist because an existing kind could not express them without
lying about what it encodes, and each says so in its doc comment. `funnel`
defaults to a **log** scale: a pipeline spanning millions down to tens renders
every stage after the first as a sliver on a linear axis, a claim about the
scale masquerading as a claim about the data. `radar` is capped at three series
because the validated palette only clears all-pairs colour separation for three
slots. `radial` is a gauge, not a share — magnitude against its own ceiling,
which is what "62% of the error budget remains" means and what a pie cannot say.
`callout` always spells the status word out beside the colour.

Two encoding details: `timeseries.y` accepts bare field names *or*
`{ field, mark, stack }` objects, normalised exactly once by `seriesOf()` so no
consumer re-decides what a bare string means; and `bar.colorBy` reads the tint
from a *second* column, so filtering never repaints the survivors — colour
follows the entity's state, not its rank. A `kpi` may likewise read its chrome
from the row (`labelField`, `unitField`, `deltaField`, `inverseField`,
`breachField`, `basisField`, `meaningField`): when a producer already computed a
metric's label, unit and delta, repeating them in the spec means two places to
update and a spec that goes stale the moment the producer moves a threshold.

### `fillGaps`, and why an empty bucket is not a zero

`timeBucket` defaults to `fillGaps: true` and emits missing buckets **as `null`,
not as `0`**. An absent bucket and a zero bucket mean different things: "nothing
happened" and "we have no observation" are different findings, and a line drawn
straight across the hole asserts the first when only the second is known.
Downstream, `connectNulls` defaults to `false` so the line actually breaks — it
is only safe to turn on when the profile reports the series as `regular`.

## 3. The profiler — `profile.ts`

Turns a plain JSON document into named base tables with statistics, and nothing
else. It never renders and never consults a model.

- **`findTables(doc)`** walks up to depth 4 looking for arrays-of-objects. Real
  exports bury the interesting rows one or two keys down (`{"data":{"results":
  [...]}}`), and it also descends into the first element to catch nested detail
  arrays (line items). Results are sorted biggest-first.
- **`flattenRow(row)`** collapses nested objects into dot paths (`customer.plan`)
  to depth 3 so every leaf is chartable. Arrays of objects become `key.count`;
  arrays of scalars become a joined string.
- **`profileField(name, values)`** infers a `SemanticType` (temporal,
  quantitative, nominal, ordinal, boolean, identifier, geo, url, text) from the
  values *and* the field name — a bare large integer only becomes a timestamp if
  the name looks temporal, or every id turns into a date. It computes the
  sub-profile that type deserves (numeric min/max/median/p05/p95/stddev/skew/
  zeros/negatives/integral/**monotonic**; temporal min/max/granularity/
  **regular**/spanDays; categorical topValues/entropy/isBinary/ordinal ladder)
  and assigns a `FieldRole` — `time`, `measure`, `dimension`, `id`, `ignore` —
  with a written `note` explaining why.
- **`profileTable(id, path, rows)`** flattens, profiles every key, and detects
  the table's `grain`: the smallest set of fields whose combination looks unique
  per row. A hint for the agent, not a constraint.
- **`profileDocument`** names tables from their JSON *path*
  (`$.data.orders → orders`, `$.orders[].items → orders_items`), not their array
  position. Position-numbered tables (`t1`, `t2`) silently rebind every block in
  a spec when a producer adds a key earlier in the document. The largest table
  additionally keeps the id `raw` for compatibility, and gains an `alias` under
  its own name so a spec can say `from: "incidents"` regardless of which table
  happens to be biggest this run.

Sampling limits: `SCAN_LIMIT = 50 000` rows per table (statistics stay honest far
below this), `EXAMPLE_COUNT = 3`, `TOP_VALUES = 12`, `MAX_TABLES = 24`.
Truncation is never silent — each produces a `warning` on the profile, which
flows into the spec's `notes` and onto the page. `buildBaseTables` rebuilds the
row arrays keyed by the ids blocks bind to, matching **by path** so a document
whose tables changed size (and therefore order) still binds correctly.
`withAliases` is separate on purpose: aliases share a reference in memory but
`JSON.stringify` expands each into a second full copy, which doubled a 1.5 MB
payload the first time it shipped.

## 4. The digest — `digest.ts` — the key safety property

**The digest is the only view of the data any agent gets.** The terminal
composer and the in-window editor both compose against it, and neither ever sees
a row.

That is what makes "never write a number into a spec" *enforceable* rather than
aspirational: a model that has not seen a figure cannot copy one out. It gets the
shape of the data — per table: path, row count, grain, time fields, measure and
dimension counts, then one line per field with its semantic type, role, ranges,
medians, distinct counts, top category *labels*, unit guess, null fraction and
the profiler's note — plus the profile's warnings. Not one row.
`candidateDigest` renders the recommender's output in the same register: score,
kind, span, rationale lines, and the derivations each candidate needs.

It lives in core rather than in `bin/` because the web route needs it too, and
`bin/shared.ts` resolves the repository root at import time — plumbing a request
handler has no business depending on.

## 5. The recommender — `recommend.ts`

A small constraint solver in the spirit of Draco.

**Hard constraints** eliminate encodings that are wrong for the data: a pie of
400 categories, a line over an unordered dimension, a correlation view over
50 000 overplotted points. **Soft constraints** carry a weighted cost, so what
survives can be *ranked* rather than merely permitted — a `Candidate` starts at
score 100 and pays for every violation, and every deduction pushes a
human-readable line onto `rationale`.

The agent does not have to take the top candidate. It has to **pick from the
list and say why**. That is the division of labour: chart *form* is decided by
rules that can be audited and fixed, and the model spends its judgement on which
*question* the dashboard should answer.

Generators: `kpiCandidates` (up to four ranked measures; a time field buys a
bucketed sparkline and a period-over-period delta, its absence costs 12 points
and says so), `timeseriesCandidates` (bucket width follows the *span*, not the
row count — two years drawn per-day is 730 unreadable ticks — and inserts LTTB
when the estimate blows `LINE_MAX_POINTS`), `breakdownCandidates` (cardinality
decides the mark: within `BAR_MAX_CATEGORIES` it sorts, beyond it inserts a
`topK` with `other: true`; a donut is only offered under `PIE_MAX_CATEGORIES`
with no negatives), `distributionCandidates` (histograms where values actually
vary, scatter only for two independent measures under 5 000 rows), and
`tableCandidate` (ids and long text are useless as axes and are exactly what you
want in a row).

`chooseMode(rowCount)` picks the transport: **client** ships base rows and runs
the same algebra in the browser so filters recompute live; **server** ships only
computed frames and the rows never leave the machine that produced them. The
threshold is `LIMITS.CLIENT_MODE_MAX_ROWS` (25 000), and `rules.ts` enforces it
as an error with a repair that flips the mode.

## 6. Perceptual limits — `limits.ts`

Every constant the recommender avoids, the validator rejects and the repair
layer fixes, in one leaf module.

These used to live in `recommend.ts`, which meant `validate.ts` imported the
recommender: **the gate importing the solver**. Adding a repair layer that needed
both would have made the cycle worse. Nothing in `limits.ts` imports anything but
types, so all three depend on one definition without depending on each other.

| constant | value | the reason |
|---|---|---|
| `PIE_MAX_CATEGORIES` | 6 | palette-bound, not geometry — a 7th slice has no colour that passes CVD separation against its neighbours |
| `BAR_MAX_CATEGORIES` | 25 | beyond this a bar chart is a barcode |
| `MAX_SERIES` | 6 | distinguishable series before colour stops carrying meaning |
| `LINE_MAX_POINTS` | 500 | points per line before LTTB is inserted |
| `TABLE_VIRTUALIZE_ABOVE` | 200 | rows a table renders unwindowed |
| `SCATTER_MAX_POINTS` | 5 000 | overplotting into a solid mass |
| `CLIENT_MODE_MAX_ROWS` | 25 000 | rows shipped to a browser |

Every number is a design decision with a reason, not a magic constant — and when
one is wrong, it is wrong in exactly one place.

`limits.ts` also owns two semantics functions. `formatFor(field)` maps a guessed
unit onto a `MeasureFormat` (deliberately narrower than `Format`: `duration` is
an author's choice for a computed column, not something the profiler has any
basis to infer). `aggFor(field)` returns the *safe* aggregate — `last` for a
monotonic running total, `avg` for a percentage, `p95` for a duration, `sum`
otherwise. That last one is load-bearing: three KPI rules in `rules.ts` print a
fix string that literally names `aggFor`'s output (`Use agg: "last"`), and the
repair calls the same function, so a repair cannot set something the error
message did not promise.

## 7. The algebra — `algebra.ts`

Pure, dependency-free and **isomorphic on purpose**: the same code runs in the
generator to materialize frames and in the browser so filters recompute live.
One implementation means a filtered number can never disagree with the number it
replaced.

- **`aggregate(values, agg)`** — `count` and `countDistinct` operate on the raw
  values; `first`/`last` pass through; the rest coerce and **drop nulls rather
  than treating them as zero**, returning `null` when nothing numeric survives.
  `median` and `p95` are interpolated quantiles.
- **`floorTime(ms, unit)`** — floors in **UTC**, always. Local time would make a
  result depend on who ran it. Weeks start Monday (ISO).
- **`lttb(rows, x, y, threshold)`** — Largest-Triangle-Three-Buckets. Picking
  every Nth point flattens spikes, which on a dashboard means silently deleting
  the incident someone is looking for. LTTB keeps the endpoints and the extremes
  that define the silhouette.
- **`runPipeline(base, derivations)`** — seeds the frame map with the base
  tables (so a block can bind straight to `raw`), then repeatedly applies any
  derivation whose `from` already resolves. An unresolvable node throws with the
  offending ids *and* the known frame names; a leftover set throws "cycle".
  Returns every frame, base tables included.

Notable behaviours inside `applyDerivation`: `topK` sums **only** the ranking
metric into the `Other` row (averaging or summing the rest would be nonsense);
`derive`'s `div`/`pctOf`/`pctChange` return `null` on a zero denominator rather
than `Infinity`; `window`'s `rollingAvg` emits `null` until the window is full,
because a partial average understates the trend.

## 8. Size contracts — `contracts.ts`

What a block needs in order to remain legible, and what it becomes when it
cannot have it.

Contracts are keyed by **variant, not by kind**. `bar.horizontal` is a contract
in exactly the same way `bar` is, so stepping down a ladder is
`CONTRACTS[c.next]` with no special case anywhere in the solver:

```
timeseries ──► timeseries.sparkline ──► ∅
bar ──► bar.horizontal ──► bar.top5 ──► bar.list ──► ∅
pie ──► pie.share_bar ──► ∅
callout ──► callout.compact ──► callout.count ──► ∅
scatter ──► ∅        (the one form with no ladder)
```

Each contract carries `min`, `ideal`, optional `aspect` band, `grow`,
`priority`, optional `perRow`/`maxH`, `next`, and — mandatory — **`legibility`**:
a written justification for the minimum, surfaced in the layout inspector. That
prose matters more than the number. *A threshold nobody can argue with is a
threshold nobody can fix*, and these will need tuning against real windows.

The budget they are designed against is the **DOS window floor, 468×288**, minus
window chrome and Disco's own header: roughly **436×176 of content**. At that
size a `timeseries` (min 280×160) barely fits and a `pie` (min 200×200) does not.
**Degradation is the normal path at that size, not an edge case** — which is why
every kind except `scatter` has somewhere to go, and why `kpi` and `callout`
never hide at all: a dashboard with no number on it has stopped answering its
question, and one that drops its "needs attention" list has hidden the only
urgent thing on the page.

`aspect` bands are only given to marks whose *shape* carries meaning — a
stretched line chart exaggerates slope, which is a lie about the data; a taller
bar chart just has taller bars, so `bar` and `histogram` have no band. `pie` has
none either: a donut shares a row, rows share one height, so demanding a square
card would stretch its neighbour or shrink the circle below legibility. The
circle is centred in whatever card it gets and the legend moves to the side when
the card is wide.

`affordancesFor(variant, w, h, hint)` answers "what may this block draw at this
size" — title, subtitle, legend and side, axes, grid, value labels, tick counts,
`maxItems`. Axis affordances are withheld from kinds that do not plot against
axes (`text`, `table`, `kpi`, `funnel`, `callout`), so the solver never budgets
height for chrome that will not be drawn. `intrinsicHeight` lets row-driven forms
ask for `perRow × rows + 40`, capped at `maxH`; with no hint yet it asks for the
*ideal* rather than the minimum, because a table that renders one row tall and
jumps to full height next frame is worse than one that starts roomy and settles.

## 9. The layout solver — `layout.ts`

`solveLayout(blocks, rect, hints, options) → Layout`. A **pure function of the
rect alone**: no DOM, no clock, no randomness, no viewport.

Viewport breakpoints are meaningless here. Disco renders inside a window the user
drags to any size above the 468×288 floor, and **a 500px window on a 27" monitor
is still 500px**. Purity is what makes the solver snapshot-testable, safe in SSR,
and cheap enough to call on every frame of a resize drag.

It is a **line breaker, not a bin packer.** Masonry would reorder blocks to fill
gaps, but spec order is the composer's argument about what matters — scrambling
it to save whitespace destroys the thing the agent was asked to produce. **The
solver chooses breaks and sizes and never reorders.**

```
A. per block: pick variant (hysteresis) → widen span → degrade if even a full row is too narrow
B. group consecutive KPIs into an atomic band
C. greedy line break, in spec order
D. distribute leftover columns; even out width ratios
E. row height: intrinsic → aspect band → contract clamp → rhythm cap
F. (scroll: "none" only) demote the lowest-priority block and re-solve
```

Columns come only from divisors of 12 (`1, 2, 3, 4, 6, 12`) so `span * cols / 12`
is exact integer arithmetic — a `span: 8` block is exactly two-thirds of the row
at *every* window size, instead of rounding differently as the user resizes.
`MIN_COL_PX = 64` is a granularity floor, not a legibility one: a block never has
to fit in one column, since step A widens it.

The invariants the tests assert, and why:

1. **A KPI band is all-or-nothing.** Four tiles, or two, or one — never three and
   an orphan, the single most visible way a generated dashboard looks broken.
   `reflowBand` only picks a tiles-per-row that divides the count evenly, then
   maximises fill.
2. **Widest ≤ 3× narrowest in a row.** Past that, width stops reading as
   hierarchy and reads as a bug.
3. **Aspect bands hold slope honest.** A block with a band keeps its own height
   and top-aligns rather than being stretched by a taller neighbour.
4. **The last row absorbs leftover columns** — except a lone non-growing block,
   because a 1200px-wide KPI tile looks worse than a gap.
6. **No row more than twice its predecessor**, so a 380px table under an 80px KPI
   band does not read as two unrelated documents — *unless* legibility demands
   the height, in which case rhythm loses and a note says so.
8. Non-scrolling embeds degrade by **ascending priority**: the least important
   block gives way first.
9. **Hysteresis**: a degraded block only climbs back with `HYSTERESIS_PX = 12` of
   real headroom, or dragging a resize handle across a threshold makes the chart
   strobe between two forms.

Everything the solver conceded is reported: `degradedFrom` + `degradeReason` per
block, `hidden[]` with a measured reason, and `notes[]` for the "why does it look
like this" popover. `layoutHints` measures the data facts (row count, category
count, series count, longest label) **once per data change** and is deliberately
separate, so a resize never touches a row.

## 10. Degraded rungs — `components/disco/rungs.tsx`

The rule every rung follows: **a rung drops a *channel*, never a *fact*.**

- `timeseries.sparkline` — loses both axes, keeps the shape, and **labels its
  endpoints** so the scale the axes carried is still on the card.
- `pie.share_bar` — one 100%-stacked bar plus wrapped labels. Loses the angle
  encoding, keeps **every share exact** as a percentage; angle was always the
  weakest part of a donut.
- `bar.top5` / `table.top5` / `bar.list` — lose the tail, and **say how much they
  dropped**: `+ 12 more not shown — widen to see them`, `5 of 1,204 rows · 2 of 7
  columns`.
- `funnel.compact` — per-stage attrition and durations drop, so the **total lost
  is stated instead**; a funnel that quietly stops mentioning what it lost is the
  one thing the block exists to prevent. `funnel.list` trades the scarce axis
  (width) for the cheap one (height) and keeps every stage.
- `radar.bars` — "Silhouette dropped — every value kept, scaled 0–max."
- `radial.bar` — "Arcs dropped — each bar is the same magnitude against max."
- `callout.count` — titles go, but the count and the **worst severity, spelled
  out**, remain: the one fact that must survive every size is that something is
  wrong.

**Nothing here silently shows less data than it appears to.** That would make a
small window a source of *wrong conclusions* rather than merely a smaller view.
The renderer reinforces it: a degraded block carries a `simplified · widen to
restore` badge whose tooltip names the rung and quotes its `legibility` line.

This file also owns the shared status vocabulary, and the dependency runs one
way — `blocks.tsx` and `blocks-extra.tsx` import from here and nothing here
imports back, because a severity that classified differently at full size than at
a degraded one would be worse than either. `severityOf` matches a *family* of
producer spellings (`SEV1`, `p1`, `breach`, `down`…) and an unrecognised word is
never `ok`: a vocabulary this block has not seen is a reason to look at the row.
The word shown is always the producer's own, and colour is never the message —
`statusWord` accompanies `statusTint` everywhere.

## 11. Controls — `controls.ts`

What a reader may narrow without editing the spec: `timeRange` and `dimension`,
up to eight per dashboard.

The whole design rests on one decision. A control compiles into a **single
`filter` derivation at the root of each table**, and every derivation that read
that table is rewritten to read the filter:

```
raw ──► ctl__raw (filter) ──► groupBy ──► topK ──► block
```

Filtering anywhere else is subtly wrong in a way nobody notices:

- **Filter a chart's output** and `topK`'s `Other` row still sums the rows you
  excluded — the tail is computed upstream of the filter, so "Other" silently
  describes a population that is no longer on screen.
- **Filter the base outside the pipeline** and a percentage-of-whole is a
  percentage of the *wrong whole* — the numerator moved and the denominator did
  not.

Injecting at the root means every aggregate downstream recomputes against exactly
the rows the reader can see, using the same algebra that produced the unfiltered
numbers.

Ranges are **relative, never absolute** (`last_24h` … `ytd`, `all`):
`{ from: "2026-01-01" }` is correct for exactly one day, and a preset survives
the data growing underneath it. They anchor to **`data_max` by default**, not the
wall clock — a batch producer is nearly always behind, and anchoring "last 24
hours" to `now` against a run produced yesterday blanks the dashboard entirely.
Dimension options refresh from the live profile, so a value that appears in a
later run shows up in the filter on its own, and a stale selection is dropped
rather than left filtering everything out.

`applyControls` never mutates the authored spec — controls are a *view* over it,
so clearing a filter restores the original exactly — and `stripControls` removes
the injected nodes on the way to disk, because persisting a reader's momentary
selection would make the next run filter twice. The `ctl__` prefix reads as
"internal" while staying inside the schema's id rule; a leading underscore looks
more obviously generated but fails to parse, which made every control-filtered
spec invalid in a way that only surfaced downstream.

## 12. The patch protocol — `patch.ts`

Every change to a dashboard — conversational, a pinned repair, a dragged span —
arrives as a list of typed ops and applies as a **transaction: whole or not at
all**.

That is not defensive coding; it is the only way an agent can be allowed to edit
a live dashboard. A half-applied patch leaves a spec referencing a derivation
that was never added, and the failure surfaces three layers away as a blank card.
Rejecting the whole patch and handing back **the validator's own `fix:` lines**
means the agent gets a correction it can act on while the user's dashboard stays
untouched.

Sixteen ops: `addBlock`, `removeBlock`, `updateBlock`, `changeKind`, `setSpan`,
`reorderBlocks`, `retitle`, `addDerivation`, `removeDerivation`,
`updateDerivation`, `rebind`, `addControl`, `removeControl`,
`setControlDefault`, `addNote`, `setMode`. `reorderBlocks` demands a full
permutation rather than a move, so its inverse is trivial and it is idempotent.
`PatchOpSchema` re-parses the union at runtime, because "typed `Patch`" is a
promise the compiler cannot keep once the patch arrives over HTTP from a model —
without it a malformed op reaches `applyOp` and the rejection names `undefined`
as the failing operation, useless as a retry prompt.

`applyPatch`, in order: `structuredClone` the spec (cheap — a spec is
single-digit kilobytes) so a rejection cannot have touched the caller's copy;
apply each op, returning the failing **index** on the first `OpError`;
`dedupe(gc(...))`; re-parse against `disco/v1`; `resolve` against the data; solve
the layout. A block the patch *added* that lands hidden is a **rejection** — "a
radar needs 220×220; this window has 180 of height" is a better answer than
silently adding something the user cannot see and will ask about.

- **`gc(spec, baseIds)`** sweeps derivations nothing binds to any more, marking
  from **every** binding site via `frameBindings` — the site a hand-written
  version once forgot. Control filter nodes are roots: a reader's filter is not
  garbage just because no block names it directly.
- **`dedupe(spec)`** collapses derivations that compute the same thing, hashing
  `from` as the *parent's hash* rather than its id so two identical groupBys over
  differently-named but identical parents collapse together. It runs strictly
  **after** `gc` — reversed, a soon-to-be-garbage derivation can win a tie,
  become the survivor, then get swept, leaving dangling references that only fail
  when the pipeline runs. The canonicaliser sorts keys at every depth; the
  obvious `JSON.stringify(rest, keys.sort())` is an *allowlist* applied at every
  depth, which stripped `agg: { amount: "sum" }` bare and hashed a sum
  identically to an avg. Survivors are chosen in lexical order so a spec diff
  stays reviewable.
- **`History`** is a bounded (50) stack of **authored-spec snapshots**, not
  inverse ops — inverting `changeKind` op-by-op means remembering every field the
  old kind had, and snapshots cannot drift from op semantics because they do not
  model them. They are pre-`resolve` on purpose: a donut auto-converted to a bar
  during a wide run must still be a donut in the history, or undoing past that
  point bakes a transient repair in permanently. Only committed patches enter it.

## 13. Late binding — `resolve.ts`

A spec is authored once and rebound to whatever the producer dropped this run.
Between runs the data moves underneath it: a dimension gains a seventh category
and the donut becomes unreadable, a date range extends and the line chart blows
its point budget, a table crosses the row limit. **None of that is a spec bug** —
the spec was right when it was written — so the answer is not to reject it but to
adapt the encoding **and say so**.

Two rules make that safe rather than spooky:

1. **Repairs are NEVER persisted.** They are applied to a copy on the way to the
   renderer. A donut converted to a bar because categories grew must become a
   donut again when they shrink, and it can only do that if the authored spec
   still says "donut".
2. **Every repair is surfaced.** Silent adaptation is indistinguishable from a
   bug, and worse, it hides the fact that the data changed shape — which is often
   the more interesting finding. Each `AppliedRepair` carries the rule id, the
   `note` in past tense, the measured `because` ("9 categories, above the
   limit"), a `lossy` flag when it hides data, and the ops themselves — so
   `pinnable()` can turn a repair the reader agrees with into a permanent patch
   at zero cost.

The loop: resolve controls **first** (repairs must judge the data the reader
actually sees), then validate → repair → validate to a fixpoint, capped at
`DEFAULT_MAX_PASSES = 3`. The cap is generous: every repair steps strictly *down*
a ladder and none can re-enable a form it just disabled, so the violation set
shrinks monotonically and a fixpoint arrives in one or two passes. A monotonicity
guard stops early if the count did not shrink — turning a hypothetical cycle into
a visible warning rather than a hung render. `canRewriteDerivations` is false in
server mode, where there are no base rows to re-run a pipeline against, and
repairs that rewrite derivations simply become unavailable.

There is **no fallback execution**. If validation could not produce frames, the
frame map is empty. Quietly re-running the pipeline anyway would render numbers
from a spec that failed its own gate.

### The gate — `validate.ts` + `rules.ts`

`validate` is the *sequencer*; the checks live in `rules.ts`. Phases run
`schema → structure → binding → perceptual → dashboard`, and each stop is
deliberate: running a binding check against frames that could not be computed
reports cascading noise instead of the one real problem. An empty primary frame
suppresses that block's field checks, because every field in an empty frame reads
as missing.

Each rule measures the data **once** and emits three things from those same
facts: the message a human reads, the prose `fix` an agent applies, and — where
mechanically fixable — the `RepairOp[]` that fixes it. That is what makes drift
impossible rather than unlikely: the error cannot say "use `agg: last`" while the
auto-repair sets something else. `formatIssues` output is an interface an agent
parses, and its whitespace is load-bearing enough to have a golden test.

## 14. Binding sites — `bindings.ts`

One place that answers "which frames does this block need", and one place that
answers "which fields, from which frame".

It exists because that question was answered independently in three places and
one of them was wrong: **the materializer collected `block.from` and forgot that
a KPI also binds `spark.from`**, so server-mode dashboards shipped without their
sparkline frames — which silently killed the period-over-period delta too, since
the delta is derived from the spark frame.

`frameBindings(block)` is now the single exhaustive list; `fieldBindings(block)`
returns `{ frame, field }` *pairs*, because a KPI's `field` lives in `from` while
its spark's `x`/`y` live in `spark.from`, and checking a spark field against the
value frame reports a field that is present as missing. `reachableFrames` walks
`from` edges up the DAG — the mark phase of the patch collector and the set the
materializer ships. A block kind added later declares its binding sites once and
the validator, the materializer and the GC all pick it up for free.

## 15. Rendering — `components/disco/surface.tsx`

`DiscoSurface` knows nothing about viewports, breakpoints or pages. **Give it a
rect and it asks the solver.** That is what lets the same component render at
1920px on a desktop, at 468px in an OS window, and at 300px in a side panel
**without a single media query**.

It holds no state beyond memoized derivations, so the shell above it owns
filters, undo and the agent conversation. Keeping it dumb is what makes it
reusable as a substrate other apps call.

- **Client mode** takes `base` rows, applies the active filter predicates, and
  runs `runPipeline` in the browser. If the pipeline throws it renders a visible
  failure and **never falls back to the unfiltered pipeline** — unfiltered
  numbers beneath an active filter are a confident wrong answer, which is worse
  than a visible failure. **Server mode** takes `staticFrames` and rows never
  arrive.
- The rect is quantised to 8px before solving: a drag across 900 pixels becomes
  ~110 solves instead of 900, and nobody can see the difference. The previous
  layout is carried in a ref (not state, which would loop) to feed hysteresis.
- Axis tick granularity is resolved to a **fixpoint** up the derivation chain,
  because `timeBucket → derive → downsample` is an ordinary chain and stopping at
  the first step falls back to "day" — an hourly window then prints the same date
  label fourteen times.
- Hidden blocks are **stated, not vanished**: a dashed panel lists each one with
  the solver's reason, or a narrow window silently becomes a different dashboard
  than the one composed.
- `useElementRect` measures the *element* via `ResizeObserver` (`borderBoxSize`,
  to avoid a forced reflow per frame), never the viewport.

`blocks.tsx` is the catalog and the ceiling of what a generated dashboard can be:
nothing there decides its own size — every component receives `w`, `h`, its
`variant` and an `affordances` record and renders exactly what it was told it has
room for. `substrate.ts` wraps all of this into the API another app calls:
`discoRender({ data, question, rect, spec?, now, state? })` returns a
`DashboardHandle` with `patch`, `undo`, `reflow` and `rebind`. `rebind` carries
the **spec** forward and re-resolves it; it does not recompose, or every edit the
caller made would be lost each time the producer dropped a document.

### `virtual-table.tsx`

Windowed above a couple of hundred rows, because the alternative — fifty thousand
DOM nodes — is a frozen tab, and a dashboard that locks the browser is worse than
one that shows nothing. `LIMITS.TABLE_VIRTUALIZE_ABOVE` is the threshold and
`table.needs_virtualization` enforces it as an error with a repair.

Deliberately **not** the shadcn `<Table>`: virtualization needs absolute row
positioning, which a semantic `<tbody>` cannot give. Same visual language,
different mechanics — a CSS grid header over an absolutely-positioned virtual
list from `@tanstack/react-virtual`. The table never picks its own height; the
solver assigns it, minus 56px of header and footer chrome. The footer always
states which mode it is in (`50,000 rows · windowed` vs `showing 25 of 1,204
rows`).

## 16. Producing runs

- **`npm run seed:artifacts`** → `scripts/seed-artifacts.ts`. Writes one
  immutable run to `artifacts/runs/<id>/`: `dashboard.json` (the whole document)
  and `meta.json` (header, seed, per-table row counts). Flags:
  `--window 30`, `--seed 123`, `--asOf <ISO>`, `--out DIR`.
  - The run id derives from `asOf` alone, never `Date.now()` — an id that reads
    the clock makes every run unique even when its contents are identical, which
    turns "did anything change?" into an unanswerable question. Separators are
    replaced rather than stripped so the id stays fixed-width and big-endian and
    sorts chronologically as a byte comparison. `producedAt` equals `asOf` for
    the same reason: one wall-clock field destroys byte-comparison, the only
    cheap way to prove the producer is deterministic.
  - **The window is always the widest one.** Narrower views are a filter over
    this document via a time-range control at read time. A run per window would
    put the same estate on disk four times and let "last 7 days" and "last 30
    days" disagree.
  - Numbers round to three decimals — `28.333333333333332` is not more accurate,
    only longer, and it keeps the file diffable. Tables are `snake_case` and
    nested values flattened (`attrition_reason`, not `attrition.reason`), because
    a block binding to a dotted field cannot be told apart from one binding to a
    field literally named that. The script asserts the table count against the
    profiler's limit and warns about empty arrays, which the profiler never sees.
  - `dashboard.json` is written **before** `meta.json`, since `listRuns` gates on
    the former and the other order is the one that can expose a partial run.
- **`lib/sre/generate.ts`** is the synthetic estate behind that run: sources,
  alerts, incidents, services, and the derived tables (`computeMetrics`,
  `buildPipeline`, `buildAttention`, `radarAxes`, `causeBreakdown`,
  `severityBreakdown`, `incidentHeatmap`). Its shape is the argument the
  dashboard makes — reliability work is a *pipeline with leaks*, not a pile of
  counters — which is why the funnel sits at the top of the page. `seed-artifacts`
  is its only consumer; the app reads the run, never the generator.
- **`npm run import:sre-runs`** (*not yet on `main`*) → `scripts/import-sre-engineer-runs.ts` builds
  runs from the SRE engineer's recorded outputs in `sre-engineer/outputs/`.
  Deliberately an **adapter, not a generator**: every displayed fact is read from
  a captured incident or alert artifact, so the dashboard never quietly
  substitutes a plausible synthetic estate for INC-001.
- **`lib/artifacts/dashboard.ts`** binds a pinned spec to a run. The two halves
  are separate on disk on purpose: `artifacts/specs/<id>.json` is authored and
  versioned, `artifacts/runs/<runId>/` is produced and immutable. A new run
  **rebinds** the same spec rather than regenerating one, which lets a reader's
  edits survive a producer dropping a document every few minutes. It returns
  `null` rather than throwing when either half is missing — the common case is a
  checkout where nobody has seeded yet, and the page should say so. First paint
  goes through the same binder the run stream uses, so a server-rendered
  dashboard and one that has swallowed three new runs cannot have been built by
  different code.

## 17. The `bin/` tooling — `packages/disco-core/bin/`

| script | one line |
|---|---|
| `profile.ts` | Stage 1: profile the input JSON to `outputs/<slug>/profile.json` and print the digest plus recommendations. Everything downstream reads the profile; nothing downstream reads the rows. |
| `compose.ts` | The deterministic baseline — a complete, valid spec from the recommender with no model in the loop. Both the fallback and the floor the agent has to beat. |
| `author-sre-spec.mjs` | Run once by hand to author the pinned SRE spec; its output is committed. Re-run it to change the *design*, never to pick up new data. |
| `verify.ts` | The gate. Exit 1 means the spec does not ship, and the printed issues are written to be pasted straight back into the composer as a retry prompt. |
| `materialize.ts` | Turn a validated spec into what the renderer loads — base rows in client mode, computed frames in server mode. |
| `check-sre.ts` | Read-only: resolve the pinned SRE spec against the newest run and print the repairs and anything unresolved. |
| `probe-layout.ts` | Print how a spec lays out at the OS floor, a narrow embed, half screen and desktop. For a human to read; not part of the pipeline. |
| `seed-artifacts.ts` | The package-local twin of `scripts/seed-artifacts.ts`. |
| `shared.ts` | Root-relative `read`/`readJson`/`writeJson`/`exists`/`slugify`/`die`, and a re-export of the digest from core. |

# PR not opened — the proposal is complete, only the push failed

The remediation for inc-001 is finished and passed blind review CLEAN. What did not happen is
the PR. This file is the difference between those two facts, so nobody has to guess which one
they're looking at.

## What happened

The commit exists. The push was blocked by this environment's command guard:

```
git push -u origin remediation/inc-001-product-catalog-1786278957
→ Destructive command detected — confirm before running.
```

The guard requires interactive confirmation. This capability runs unattended, so there was
nobody to give it. I did not override the guard: pushing to a shared repository is an
outward-facing action, and silently disabling a safety check to do it unattended is exactly
the kind of thing that should require a human, not a workaround. Two differently-shaped
attempts hit the same guard, so I stopped rather than keep hammering a declined action.

Access was not the problem — `gh auth status` is authenticated and
`gh repo view satya-brata645/trata-sreoncall --json viewerPermission` returns `WRITE`. No fork
is needed.

## State left behind, ready to push

- **Throwaway clone:** `/private/tmp/sreoncall-pr-inc-001-1786278957` (preserved, not deleted)
- **Branch:** `remediation/inc-001-product-catalog-1786278957`
- **Commit:** `02f4299b8d84caefa352a4766a82306c7419dcb6`
- **Contents:** `sre-engineer/remediations/inc-001/{proposed-change.md,rationale.md}`,
  464 insertions, no other files touched
- **PR body, fully written:** `/private/tmp/pr-body.md`

The live working tree was never touched — all git work happened in the throwaway clone, as
required.

## To finish it

```bash
cd /private/tmp/sreoncall-pr-inc-001-1786278957
git push -u origin remediation/inc-001-product-catalog-1786278957

gh pr create --repo satya-brata645/trata-sreoncall --base main \
  --head remediation/inc-001-product-catalog-1786278957 \
  --title "inc-001: config remediation for product-catalog GetProduct failures (no code change needed)" \
  --body-file /private/tmp/pr-body.md
```

If the scratch clone has been cleaned up by then, the two documents in this directory are the
authoritative copies — the clone was only ever a staging area for the PR.

## What this is not

This is **not** `type: "deferred"`. A deferred remediation means no safe change could be
proposed. Here a real, reviewed, evidence-backed change exists and is written down in full;
only the delivery mechanism failed. Losing a good fix because a push was blocked helps nobody,
which is why the local copy is the audit trail and the PR is just transport.

Note also that the proposal's *content* was never going to be applied by merging a PR — it is
a runtime configuration change to the live flagd instance, which no repository merge performs.
The PR's job is to put the reviewed proposal in front of `release-approval` and into the
record. The absence of the PR delays that review; it does not change what needs to be done to
the live system, and it does not make the incident any less remediable.

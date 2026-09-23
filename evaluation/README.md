# Detector evaluation fixtures

The [v3 authorship prompt evaluation](authorship-prompt-v3.md) records the September 2026 Jev-only comparison, held-out source groups, per-example results, and observed sensitivity tradeoffs.

Automatic feeding remains experimental until the detector is evaluated against known examples. Keep a private JSONL file outside the extension package with at least 100 `human` and 100 `ai` rows.

Each row must contain:

```json
{"id":"example-001","groundTruth":"human","contentType":"post","text":"..."}
```

Rows that exercise category filters may add a `categoryGroundTruth` object, for
example `{"politics":true,"sports":false}`. The evaluator reports precision,
recall, and false-positive rates for each labeled category at Conservative, Balanced,
and Aggressive thresholds, along with average latency and TypeSafe token usage.
It still accepts the original AI-only fixture shape.

Use `groundTruth` values `human` and `ai`, and `contentType` values `post` and `comment`. Include polished human writing, informal AI writing, quotations, lightly edited drafts, and short or ambiguous examples. Do not put personal Reddit data in the repository.

Run the evaluator from the server directory:

```sh
node --env-file=.env ../evaluation/evaluate-fixtures.mjs /path/to/fixtures.jsonl
```

The evaluator requires at least 100 human and 100 AI rows, then prints aggregate counts, high-label precision/recall, human false-positive rate, abstention coverage, and 95% Wilson uncertainty intervals. It does not print fixture text or save it.

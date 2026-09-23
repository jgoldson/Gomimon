# Jev authorship prompt v3

Evaluated 2026-09-23 with `jev-1.13.0`. Production continues to use `jev-latest`.

## Change

Replace the long authorship question and ambiguous editing/polishing exclusion with one short Noul:

> Was most of the wording in `text` written or substantially rewritten by a generative AI? Personal experiences may be real even when the wording is AI-generated. Exclude minor spelling and grammar corrections. Judge the author's own prose; exclude quoted excerpts and `quoted_text`.

No extra model call, feature ensemble, score multiplier, or threshold change. Substantial AI rewriting counts; minor proofreading and someone else's quoted text do not. The server rubric changes from `social-classifier-v2` to `social-classifier-v3` to separate cached assessments. Existing client caches can retain previous results until expiration.

## Method

Data source: [RAID](https://github.com/liamdugan/raid), specifically `https://dataset.raid-bench.xyz/train_none.csv`. Human/AI labels are dataset labels, not judgments made from writing style. The user's supplied productivity post has unknown authorship and was excluded from accuracy counts.

Downloaded the first 60 eligible Reddit rows for each of `human`, `chatgpt`, `gpt4`, and `llama-chat`, requiring at least 30 words. Development used the first 15 rows per group: 15 human and 45 AI texts. The holdout excluded every development `source_id`, including AI variants of the same source post. It contains 45 human Reddit texts and 90 AI Reddit texts. The latter represent 15 source topics with six generations each; they are correlated examples, not 90 independent topics.

Added 30 human academic abstracts from RAID as a polished-writing stress test, retrieved from the Hugging Face dataset viewer (`liamdugan/raid`, config `raid`, train offset 20, length 30). These are outside GomiMon's main domain and are reported separately where useful.

Compared the current production prompt against a concise prompt, structured authorship examples, explicit ChatGPT wording, a two-option Choice, and an artifact-aware prompt. Each request used the production input validation and state builder, including the same 8,000-character limit. Only text and ordinary metadata were sent to Jev; labels, generator identities, and source IDs were withheld. Development questions shared a request; the shortlist was tested together on the holdout, then the baseline and selected prompt were each rerun alone on every holdout text to match AI-only production requests.

Additional diagnostic probes: four explicitly assistant-written texts (obvious advice, an unremoved assistant preamble, a casual post, and a personal narrative) and three human texts with a separate AI-written quote. These probes are not part of the benchmark accuracy counts. Both prompts caught the first two synthetic AI texts at 80%, missed the casual and personal examples, and left the human quote controls below 70%.

## Initial results

| Sample, 80% threshold | Current prompt | Concise prompt |
| --- | ---: | ---: |
| Development: AI detected / 45 | 6 | 16 |
| Development: human flagged / 15 | 0 | 0 |
| Holdout, batched: AI detected / 90 | 27 | 44 |
| Holdout, batched: human flagged / 75 | 0 | 0 |
| Holdout, each prompt alone: AI detected / 90 | 27 | 43 |
| Holdout, each prompt alone: human flagged / 75 | 0 | 0 |

At 70%, the batched holdout gained AI detections (47 → 76 / 90), but also flagged three human abstracts (0 → 3 / 75). Neither prompt flagged the 45 human Reddit examples at 70%. The Choice candidate caught 47 AI texts at 80%, but also flagged one human abstract; the concise Noul was selected to keep the existing output contract and the simpler one-question design.

Running each prompt alone confirmed 30.0% → 47.8% AI recall at 80%, with 0 / 75 human false positives observed for either prompt. At 70%, AI detections were 47 → 73 / 90 and human flags remained 0 → 3 / 75. At 90%, AI detections were 3 → 6 / 90, with no human flags. A separate short-text check used 25-word excerpts from 20 human Reddit texts with the `x` platform's word gate; neither prompt flagged any at 70%. These excerpts are a short-input regression probe, not an X benchmark.

Validation: server tests passed (66 passed, 3 skipped), syntax checks passed. Deployed only the authorship question and rubric version to the existing API; public and loopback health checks passed. Backups: `/srv/gomimon/backups/authorship-v3-20260923T145510Z`. No frontend or client cache format changes were needed.

## Limits

- This is a small convenience sample of an older public benchmark, not a representative production accuracy estimate. Dataset familiarity, topic clustering, and historical generators limit generalization.
- The candidate was selected on the development sample, and the holdout shortlist was also inspected. The final repeat verifies request shape and stability; it is not a new independent evaluation set.
- Zero observed false positives at 80% does not establish a zero false-positive rate. The candidate raises human scores too; the aggressive threshold has an observed tradeoff.
- The original productivity example remains below the detection threshold (about 41% with the concise guarded prompt versus 30% baseline in the six-question experiment).
- Current-model casual AI prose and personal narratives remain difficult. The change improves recall on the sampled labeled text; it does not solve authorship detection or validate displayed probabilities as calibrated real-world frequencies.
- No account history, private user data, or extra model is added. Fixture text remains outside the repository in the private experiment directory; the report and result artifact contain only prompts, IDs, labels, and scores.

## Reproduction artifacts

The private local experiment directory contains `fetch-raid.py`, `make-benchmark.py`, `make-holdout.py`, input fixtures, the full prompt variants, and remote runners. The runners use the installed TypeSafe SDK and existing server credentials without exposing credentials. No live account or database records were used to construct the evaluation.

[Recorded prompts and per-example results](authorship-prompt-v3-results.json) preserve all five experiment stages without the fixture text.

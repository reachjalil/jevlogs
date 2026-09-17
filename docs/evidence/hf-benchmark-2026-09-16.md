# Hugging Face log-triage benchmark — 2026-09-16

Worktree: `../jevlogs-hf-benchmark`, branch `hf-benchmark` from `origin/main`. Package under test: published **jevlogs@0.2.0**, not the local `src/` tree. Local uncommitted 0.3 work in the original checkout was left untouched.

## Spend (from `benchmarks/results/usage.jsonl`)

| | |
| --- | ---: |
| Jev calls with `inputTokens` | 4,476 |
| Evaluator attempts (includes 13 HDFS retries after an initial `unavailable`) | 5,523 |
| Input tokens | 2,404,514 |
| Output tokens (logged; Jev output is $0 on the model page) | 344,652 |
| Fetched Jev input price | $0.042 / million ([Gateway](https://vercel.com/ai-gateway/models/jev)) |
| Estimated spend | **$0.10099** |

Jalil should confirm this against the Vercel AI Gateway dashboard. The dollar figure is `input_tokens × 0.042 / 1e6` only.

A 20-record pilot measured ~536 input tokens/call and extrapolated ~$0.10 for the full plan, so the plan was not shrunk. Stop threshold was $8; it was not approached.

The first pilot attempt used a quoted `AI_GATEWAY_API_KEY` from `.dev.vars` and failed closed (`unavailable` in ~400 ms, no tokens). Quotes are now stripped in `benchmarks/run.mjs`. Those failed attempts are **not** in the token log.

## Links

- Dataset: https://huggingface.co/datasets/reachjalil/jevlogs-log-triage-benchmark
- Space: https://huggingface.co/spaces/reachjalil/jevlogs-triage-explorer
- Collection: https://huggingface.co/collections/reachjalil/jev-logs-log-triage-with-jev-6aab8a1c641f647b3c6eea22
- Article draft: [`docs/article/jevlogs-log-triage-findings.md`](../article/jevlogs-log-triage-findings.md)
- Runner: [`benchmarks/README.md`](../../benchmarks/README.md)

## Headline metrics

See `benchmarks/results/metrics.json`. Short form:

- **HDFS** n=2500, 750 anomalous: recall 0.9933, retain 0.0084, 5 misses all `Verification succeeded for [BLOCK]`, protection share 0, p50/p95 968/1310 ms.
- **BGL** n=2500, 750 anomalous: recall 1.0 entirely from FATAL protection, retain 0.0012, protection share 1.0, p50/p95 902/1232 ms.
- **E2** HDFS retainBelow 0.2: recall 0.921, retain 0.1056; 0.3/0.5 unchanged.
- **E3** BGL severity-only: recall 1.0, retain 0.592 (much more filtering than Jev).
- **E4** 200×2: 0 route flips.
- **E5** 40 pairs: 1 flip, normal retain→analyze.
- **E6** GPT-4.1 estimate on the HDFS sample: savings negative (~−1.4%) because 99.16% still analyzed.

## Upstream license

Loghub research/academic terms. Published bodies are sanitized. `LICENSE` notice included on the dataset repo.

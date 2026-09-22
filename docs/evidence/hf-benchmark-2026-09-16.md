# Hugging Face log-triage benchmark — 2026-09-16

Worktree: `../jevlogs-hf-benchmark`, branch `hf-benchmark` from `origin/main`. Package under test: local **jevlogs@0.3.0** (`dist/` after `pnpm build`). npm `jevlogs` was still **0.2.0** at run time. Local uncommitted work in `/Users/jalillaaraichi/jevlogs` was left untouched.

E1–E5 reused on-disk decisions from the same measured evaluator questions as `src/index.ts` (0.2.0 had no cache, which matches `cache: false` on 0.3.0). E7–E8 were live calls against the 0.3.0 build.

## Spend (from `benchmarks/results/usage.jsonl`)

| | |
| --- | ---: |
| Jev calls with `inputTokens` | 6,841 |
| Input tokens | 3,665,677 |
| Output tokens (logged; Jev output is $0 on the model page) | 526,757 |
| Fetched Jev input price | $0.042 / million ([Gateway](https://vercel.com/ai-gateway/models/jev)) |
| Estimated spend | **$0.153958** |

Jalil should confirm this against the Vercel AI Gateway dashboard. The dollar figure is `input_tokens × 0.042 / 1e6` only.

A 20-record pilot measured ~536 input tokens/call and extrapolated ~$0.10 for the E1–E5 plan, so that plan was not shrunk. E7–E8 added the remaining tokens. Stop threshold was $8; it was not approached.

The first pilot attempt used a quoted `AI_GATEWAY_API_KEY` from `.dev.vars` and failed closed (`unavailable` in ~400 ms, no tokens). Quotes are now stripped in `benchmarks/run.mjs`. Those failed attempts are **not** in the token totals above.

## Links

- Dataset: https://huggingface.co/datasets/reachjalil/jevlogs-log-triage-benchmark
- Space: https://huggingface.co/spaces/reachjalil/jevlogs-triage-explorer
- Collection: https://huggingface.co/collections/reachjalil/jev-logs-log-triage-with-jev-6aab8a1c641f647b3c6eea22
- Article draft: [`docs/article/jevlogs-log-triage-findings.md`](../article/jevlogs-log-triage-findings.md)
- Runner: [`benchmarks/README.md`](../../benchmarks/README.md)

## Headline metrics

See `benchmarks/results/metrics.json`. Short form:

- **HDFS E1** n=2500, 750 anomalous: recall 0.9933, retain 0.0084, 5 misses all `Verification succeeded for [BLOCK]`, protection share 0, p50/p95 968/1310 ms, 1,350,308 Jev input tokens.
- **BGL E1** n=2500, 750 anomalous: recall 1.0 entirely from FATAL protection, retain 0.0012, protection share 1.0, p50/p95 902/1232 ms, 792,755 Jev input tokens.
- **E2** HDFS retainBelow 0.2: recall 0.921, retain 0.1056; 0.3/0.5 unchanged (value gate).
- **E3** BGL severity-only: recall 1.0, retain 0.592 (much more filtering than Jev). HDFS severity/keyword recall ~5%.
- **E4** 200×2: 0 route flips. Mean |Δp| 0.0135, max 0.08.
- **E5** 40 pairs: 1 flip, normal retain→analyze.
- **E6** GPT-4.1 estimate on the HDFS sample (`retainedFraction` 0.9916): savings **−2.55%** ($1000 → $1025.50). Nothing-filtered overhead $33.90 / million logs. Estimates only; downstream 300/50 tokens are illustrative.
- **E7 HDFS** cache hit rate 0.9648 (2,412/2,500), 88 model calls, 88 unique bodies, 48,019 tokens. **E7 BGL** hit rate 0.1568, 1,097 model calls, 1,256 unique bodies, cacheEntries 1,000.
- **E8 HDFS** 375 PacketResponder rule hits, 75 labeled anomalies retained by that rule, recall 0.8933. **E8 BGL** 94 rule hits, 0 labeled anomalies retained by a rule, 0 rule hits on protected records.

## Upstream license

Loghub research/academic terms. Published bodies are sanitized. `LICENSE` notice included on the dataset repo.

## What was skipped or failed

- npm 0.3.0 was not published; the benchmark imported `../dist/index.js` after `pnpm build`.
- The Hugging Face community blog was not posted (draft only, as specified).
- Site was not deployed; package was not published to npm; `src/` and tests were not changed.
- `pnpm test` on this worktree at setup: 32 pass, 1 skip (live, no key in that process).
- Space had a Gradio 4 / Jinja import error on first push; it was pinned to Gradio 5 + Python 3.11 and was RUNNING at last check.
- `python3 -c 'import huggingface_hub'` is not installed on the host; uploads used the `hf` CLI.
- HDFS labels are block-level; line-level recall on that dataset overstates what a production owner would call “caught the incident.”

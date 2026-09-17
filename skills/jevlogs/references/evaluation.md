# Evaluating usefulness and estimating savings

Jev's decisions are typed, but typed does not mean right. The project's own README states that live accuracy and production savings have not been independently validated. Treat every rollout as an experiment with a control.

## Step 1: build a labeled sample

- 50 to a few hundred records, sanitized (run them through `redactCommonSecrets` plus a domain redactor, then eyeball them).
- Include records from real incidents and label which ones a human needed. Include boring health checks and cache hits too.
- Keep it as JSONL with `body`, `severityText` or `severityNumber`, and an extra `label` field that jevlogs ignores. `../examples/sample.jsonl` shows the shape.
- Get the user's explicit OK before sending it live; each record is a billed Gateway call.

## Step 2: run it

```bash
npx jevlogs --live --stdin --json --limit 100 < sample.jsonl > decisions.jsonl
```

Join `decisions.jsonl` back to the sample by `line` (one-based index over non-blank lines). Or call `createJevLogs().triage()` in a script and keep the label next to each decision.

## Step 3: metrics that matter

| Metric | How | Why |
| --- | --- | --- |
| Incident recall | labeled-important records with `route: 'analyze'` ÷ labeled-important records | the number that decides whether filtering is safe |
| Missed important events | list every important record with `route: 'retain'` | read each one; a single miss may veto rollout |
| Routing rate | `retain` ÷ all | this becomes `1 - retainedFraction` |
| Reason mix | counts of `model` / `uncertain` / `protected` / `unavailable` | high `unavailable` means timeouts or access problems, and those records cost analysis money |
| Latency | wall time per `triage()` versus `timeoutMs` (2 s) | decides batch and concurrency settings |
| Jev tokens | `usage` from a measured evaluator (`../examples/measured-evaluator.ts`) | replaces the 400-token assumption |
| Downstream tokens | the user's reasoning model usage per analyzed record, input and output, including reasoning tokens if billed | feeds `tokensPerLog` and `outputTokensPerLog` |

Recall on a labeled sample is a floor, not a guarantee. Re-sample bypassed records from the archive after rollout.

## Step 4: estimate, then compare with bills

Only the `analysis-only` branch (or a consumer acting on `route`) changes the bill. Annotation adds Jev cost on top of unchanged analysis cost.

```ts
import { estimateSavings } from 'jevlogs';

const est = estimateSavings({
  logs: 2_400_000,            // measured monthly volume on the analysis branch
  tokensPerLog: 350,          // measured downstream input tokens per analyzed record
  outputTokensPerLog: 900,    // measured output + billable reasoning tokens
  llmInputPerMillion: 2,      // current price from the provider's page
  llmOutputPerMillion: 8,
  retainedFraction: 0.62,     // 1 - routing rate; includes protected, uncertain, unavailable
  jevInputPerMillion: 0.042,  // current Jev price from the Gateway model page
  questionTokensPerLog: 420,  // measured Jev usage minus body tokens
});
// est.baseline, est.triage, est.withJev, est.savings, est.percent
```

Report it like this: "With the measured routing rate, the estimate is roughly X per month lower than the current analysis spend, before storage and retries. This is a model, not a bill." Never round it into a promised percentage. If `retainedFraction` is high the number goes negative, which is a legitimate answer: Jev is not worth it for that workload.

Prices change. Link, do not paste:

- Jev on Vercel AI Gateway: https://vercel.com/ai-gateway/models/jev
- Gateway pricing overview: https://vercel.com/docs/ai-gateway/pricing
- The downstream model's own pricing page (whichever the user runs)

## Common mistakes

- Setting `retainedFraction` to the fraction archived. Everything is archived; the parameter is the fraction still analyzed.
- Counting output tokens as zero for reasoning models. Their reasoning tokens are usually billed as output.
- Measuring recall on the offline demo. It uses fixed answers and never calls Jev.
- Comparing against a baseline that already had a keyword filter. Compare against what the user actually does today.

## Measured example (Loghub samples, 2026-09-16)

These figures are from published `jevlogs@0.2.0` on sanitized Loghub-derived HDFS_v1 and BGL samples (seed `20260916`, 2,500 lines each, ~30% labeled anomalous). They are **not** production logs. Full tables, charts, and decision JSONL: [reachjalil/jevlogs-log-triage-benchmark](https://huggingface.co/datasets/reachjalil/jevlogs-log-triage-benchmark). Runner: `benchmarks/run.mjs`.

| Dataset | Anomaly recall | Routing rate (`retain`) | Precision of `retain` | Protected share of anomalies | Unavailable | Latency p50 / p95 | Mean Jev input tokens |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| HDFS_v1 sample | 0.9933 (745/750) | 0.0084 | 0.7619 | 0 | 0 | 968 / 1310 ms | 540 |
| BGL sample | 1.0000 (750/750) | 0.0012 | 1.0000 | 1.0000 | 0 | 902 / 1232 ms | 532 |

Spend for the whole run, from the token log: 4,476 Jev calls, 2,404,514 input tokens, estimated **$0.10099** at $0.042/M input fetched from the Gateway Jev page. Confirm on the dashboard.

What that means in practice:

- HDFS has no ERROR/FATAL lines. The five “missed” anomalies were `Verification succeeded for [BLOCK]` on blocks that Loghub labeled anomalous at **block** granularity. Jev treated successful verification as routine.
- BGL alerts in this sample were all original FATAL (population: 99.982% of alerts). The local protection rule produced 100% recall without calling Jev. A WARN-or-above severity baseline matched that recall and retained 59% of lines; Jev retained 0.12%.
- Default retain almost never fires because scores cluster at 25.25–25.75 (`value <= 25` is required). Raising `retainBelow` to 0.2 on saved HDFS probabilities increases retain to 10.56% and drops recall to 0.921.
- 200 records scored twice: 0 route flips. An “ignore previous instructions” suffix flipped 1 of 40 pairs, a normal line from retain to analyze.
- `estimateSavings()` with measured Jev tokens and the measured HDFS analyze rate (0.9916) is **negative** versus a GPT-4.1 baseline that already reads every line. Jev is cheap; it does not pay off when it barely filters.

Reproduce: `cd benchmarks && npm install && export AI_GATEWAY_API_KEY=... && node run.mjs`.


# Evaluating usefulness and estimating savings

Jev's decisions are typed, but typed does not mean right. The project's own README states that live accuracy and production savings have not been independently validated. Treat every rollout as an experiment with a control.

## Step 1: build a labeled sample

- 50 to a few hundred records, sanitized (run them through `redactCommonSecrets` plus a domain redactor, then eyeball them).
- Include records from real incidents and label which ones a human needed. Include boring health checks and cache hits too.
- Keep it as JSONL with `body`, `severityText` or `severityNumber`, and an extra `label` field that jevlogs ignores. `../examples/sample.jsonl` shows the shape.
- Get the user's explicit OK before sending it live; each record is a billed Gateway call.

## Step 2: run it

```bash
npx jevlogs --live --file sample.jsonl --labels --json --limit 100 > decisions.jsonl
```

`--labels` reads `important: true/false` or `label` (`incident`/`noise` and the other words in `references/api.md`) and prints recall, precision, and miss lines on stderr. A miss exits 2. Labels are not sent to the model. `scoreDecisions()` is the same calculation when the decisions already exist. Joining by `line` still works if the file was scored without `--labels`.

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

# Five-minute integration

1. Install from the source tarball (see README); install `@opentelemetry/sdk-logs@0.222.0` in your application.
2. Set `AI_GATEWAY_API_KEY` in your server environment. Confirm your Gateway account has Jev access.
3. Wrap your current exporter in `new JevLogExporter({ exporter })`, inside `BatchLogRecordProcessor`. Use a batch size of 16 and export timeout ≥15 seconds.
4. Start in the default `annotate` mode. Inspect `jev.value`, `jev.priority`, `jev.route`, `jev.reason`, and `jev.actionable_probability` in your normal backend.
5. After evaluating against labeled incident logs, keep the original archive exporter and enable `analysis-only` on a separate processor sending to your LLM analysis queue. Missing annotations and failures must still be analyzed.

## Data and controls

The SDK sends serialized body and severity only. The default common-secret redactor is a convenience, not a complete PII policy. Supply `redact(text)` for domain-specific needs; it runs before transmission. Zero-data-retention is requested through Gateway. Provider account policies and access still apply. Never put Gateway keys in a browser.

Set `jev.protected: true` on audit, security, and other records that cannot skip analysis. ERROR/FATAL severity is protected automatically. Empty/invalid model outputs, errors, timeouts and oversized inputs stay on the analysis path. Jev's type safety doesn't guarantee correct classifications or resist every adversarial log. Validate real incident recall before enabling filtering.

## Standalone API

`createJevLogs(options).triage({ body, severityNumber?, severityText?, protected? })` returns a Promise of `{ value, priority, route, actionableProbability, reason }`. Use it in your existing job or queue without adopting the OTel wrapper. A custom `evaluator` permits local tests or another implementation of the same typed contract.

## Scope

This release integrates with Node.js OpenTelemetry Logs SDK. It is not an OTel Collector plugin, span sampler, log database, or root-cause explanation engine. It does not run the downstream LLM itself. Instrumentation and durable delivery remain your existing pipeline's responsibility.

## Tuning

`retainBelow` defaults to 0.1 and accepts 0–0.5. Retaining without deeper analysis additionally requires priority `low` and value ≤25. A threshold of 0 disables bypass. Begin with labeled incidents and routine logs, compare recall and routing rate, and review a sample of bypassed events. Calculate savings from actual billed usage and measured downstream volume.

# Receiver examples

- `jevlogs.config.json`: decisions to stdout only.
- `jevlogs.forward.config.json`: forward annotated OTLP JSON to a collector on port 4320, retain health checks by rule, flag audit lines for analysis.

```sh
cp jevlogs.forward.config.json jevlogs.config.json
cp .env.example .env   # add your AI_GATEWAY_API_KEY
OTEL_EXPORTER_OTLP_HEADERS="authorization=Bearer%20your-collector-token" npx jevlogs --live
curl -s http://127.0.0.1:4318/stats
```

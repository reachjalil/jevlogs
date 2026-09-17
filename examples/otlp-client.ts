import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';

// Run `npx jevlogs --live` in another terminal first.
// This application needs no AI Gateway key.
const provider = new LoggerProvider({
  processors: [new BatchLogRecordProcessor({
    exporter: new OTLPLogExporter({ url: 'http://127.0.0.1:4318/v1/logs' }),
    maxExportBatchSize: 16,
    exportTimeoutMillis: 15000,
  })],
});
provider.getLogger('my-app').emit({ body: 'GET /health returned 200', severityNumber: 9 });
await provider.shutdown();

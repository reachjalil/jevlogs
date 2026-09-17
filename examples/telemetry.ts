import { LoggerProvider, BatchLogRecordProcessor, ConsoleLogRecordExporter } from '@opentelemetry/sdk-logs';
import { JevLogExporter } from '../src/index.js';
const provider = new LoggerProvider({ processors: [new BatchLogRecordProcessor({
  exporter: new JevLogExporter({ exporter: new ConsoleLogRecordExporter() }),
  maxExportBatchSize: 16, exportTimeoutMillis: 15000,
})] });
provider.getLogger('example').emit({ body: 'GET /health returned 200', severityNumber: 9 });
await provider.shutdown();

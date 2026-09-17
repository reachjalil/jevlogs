// Archive branch + filtered analysis branch + a consumer stub.
// Run with Node.js 22+, `npm install jevlogs @opentelemetry/sdk-logs@0.222.0`,
// and AI_GATEWAY_API_KEY in the environment. Replace the two exporters with yours.
import {
  LoggerProvider,
  BatchLogRecordProcessor,
  ConsoleLogRecordExporter,
  type LogRecordExporter,
  type ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import { JevLogExporter } from 'jevlogs';

// 1. Archive: your existing exporter, untouched. Every record goes here.
const archiveExporter: LogRecordExporter = new ConsoleLogRecordExporter();

// 2. Analysis queue: whatever feeds your reasoning model. Here it is a stub that
//    stands in for "push onto a queue"; in real code this is your own exporter.
const analysisQueue: ReadableLogRecord[] = [];
const analysisQueueExporter: LogRecordExporter = {
  export(records, callback) { analysisQueue.push(...records); callback({ code: 0 }); },
  async forceFlush() {},
  async shutdown() {},
};

const provider = new LoggerProvider({
  processors: [
    new BatchLogRecordProcessor({ exporter: archiveExporter }),
    new BatchLogRecordProcessor({
      exporter: new JevLogExporter({
        exporter: analysisQueueExporter,
        mode: 'analysis-only',   // retain records never reach the queue
        concurrency: 4,
        retainBelow: 0.1,
      }),
      maxExportBatchSize: 16,
      exportTimeoutMillis: 15_000,
    }),
  ],
});

const logger = provider.getLogger('checkout');
logger.emit({ body: 'GET /health returned 200 in 2ms', severityNumber: 9 });
logger.emit({ body: 'Payment capture failed after three retries', severityNumber: 17 }); // protected
logger.emit({ body: 'Administrator role changed', attributes: { 'jev.protected': true } });
await provider.shutdown(); // flush once, at exit

// 3. Consumer: the application calls its own analysis model. jevlogs does not.
for (const record of analysisQueue) {
  const route = record.attributes['jev.route'];
  const priority = record.attributes['jev.priority'];
  if (route === 'retain') continue;            // defensive; analysis-only already skipped these
  // route === 'analyze' OR attributes missing (unscored overlap) -> analyze
  await analyzeWithYourModel({ body: record.body, priority, reason: record.attributes['jev.reason'] });
}

async function analyzeWithYourModel(input: { body: unknown; priority: unknown; reason: unknown }) {
  // Replace with your reasoning-model call (generateText, an Anthropic client, etc.).
  console.log('would analyze', input);
}

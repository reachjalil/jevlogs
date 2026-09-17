import { createJevPager, JevPagerExporter, shouldPage } from '../src/index.js';
import { LoggerProvider, BatchLogRecordProcessor, ConsoleLogRecordExporter } from '@opentelemetry/sdk-logs';

// One boolean. Your code owns the cut. Do not page on discrete urgency.
const pager = createJevPager({ pageAbove: 0.5 });

for (const log of [
  { body: 'INVALID_COUPON rejected at checkout', severityText: 'ERROR', service: 'checkout' },
  { body: 'Replica lag 47m on primary still accepting writes', severityText: 'INFO', service: 'orders-db' },
]) {
  const decision = await pager.decide(log);
  if (decision.page) {
    // page PagerDuty / Opsgenie here
    console.log('PAGE', log.body, decision.probability);
  } else {
    console.log('HOLD', log.body, decision.probability);
  }
}

// Same cut, if you already stored the probability:
if (shouldPage(0.91, 0.5)) console.log('would page');

const provider = new LoggerProvider({ processors: [new BatchLogRecordProcessor({
  exporter: new JevPagerExporter({ exporter: new ConsoleLogRecordExporter(), pageAbove: 0.5 }),
  maxExportBatchSize: 16, exportTimeoutMillis: 15000,
})] });
provider.getLogger('checkout').emit({ body: 'GET /health 200', severityNumber: 9 });
await provider.shutdown();

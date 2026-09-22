import { createJevPager, shouldPage } from '../src/index.js';

// One boolean. Application code owns the cut. Do not page on a discrete urgency label.
const pager = createJevPager({ pageAbove: 0.5 });

for (const log of [
  { body: 'INVALID_COUPON rejected at checkout', severityText: 'ERROR', service: 'checkout' },
  { body: 'Replica lag 47m on primary still accepting writes', severityText: 'INFO', service: 'orders-db' },
]) {
  const decision = await pager.decide(log);
  console.log(decision.page ? 'PAGE' : 'HOLD', log.body, decision.probability);
}

if (shouldPage(0.91, 0.5)) console.log('would page');

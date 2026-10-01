import pkg from '../../package.json';

// The version comes from the published package so the site cannot lag a release.
export const siteMeta = {
  name: 'Jev Logs',
  tagline: 'Keep your logs. Spend on the signal.',
  url: 'https://jevlogs.com',
  description:
    'Open-source TypeScript log triage with Jev, Vercel AI SDK, and OpenTelemetry. Score diagnostic value before expensive LLM analysis.',
  version: pkg.version,
  license: 'MIT',
  locale: 'en_US',
  themeColor: '#2448ff',
  repo: 'https://github.com/reachjalil/jevlogs',
  npm: 'https://www.npmjs.com/package/jevlogs',
  ogImage: '/og.jpg',
  ogWidth: 1200,
  ogHeight: 630,
  ogAlt: 'Jev Logs. Keep your logs. Spend on the signal.',
} as const;

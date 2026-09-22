import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { loadEnvFile } from 'node:process';
import { compileRules, type Rule, type CacheOptions } from './index.js';

export interface JevConfig {
  port?: number; envFile?: string; retainBelow?: number; timeoutMs?: number; maxInputChars?: number;
  /** OTLP HTTP/JSON logs endpoint that receives annotated records, for example http://127.0.0.1:4320/v1/logs. */
  forwardUrl?: string;
  /** annotate forwards every record; analysis-only forwards records routed to analysis. Default annotate. */
  forwardMode?: 'annotate' | 'analysis-only';
  rules?: Rule[];
  /** Derived from cacheSize and cacheTtlMs in the JSON file. */
  cache?: CacheOptions | false;
  /** Default true. Set false to cache exact redacted inputs instead of normalized templates. */
  normalizeTemplates?: boolean;
  /** Model invocations for this process. 0 allows none. */
  maxModelCalls?: number;
  /** Pager cooldown for a repeated template. 0 disables. The analysis receiver ignores this. */
  suppressForMs?: number;
}
const KEYS = ['port', 'envFile', 'retainBelow', 'timeoutMs', 'maxInputChars', 'forwardUrl', 'forwardMode', 'rules', 'cacheSize', 'cacheTtlMs', 'normalizeTemplates', 'maxModelCalls', 'suppressForMs'];
/** JSON only: configuration never executes application code. Existing environment variables win. */
export async function loadJevConfig(path?: string): Promise<JevConfig> {
  const filename = resolve(path ?? 'jevlogs.config.json');
  let text: string;
  try { text = await readFile(filename, 'utf8'); }
  catch (error) { if (!path && (error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw new Error(`Cannot read config: ${filename}`); }
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('jevlogs config must be valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('jevlogs config must be an object');
  const config = value as Record<string, unknown>;
  for (const key of Object.keys(config)) if (!KEYS.includes(key)) throw new Error(`Unknown config option: ${key}`);
  for (const key of ['port', 'retainBelow', 'timeoutMs', 'maxInputChars', 'cacheSize', 'cacheTtlMs']) if (config[key] !== undefined && (typeof config[key] !== 'number' || !Number.isFinite(config[key]))) throw new Error(`Config ${key} must be a finite number`);
  if (config.envFile !== undefined) {
    if (typeof config.envFile !== 'string' || !config.envFile.trim()) throw new Error('Config envFile must be a path');
    try { loadEnvFile(resolve(dirname(filename), config.envFile)); } catch { throw new Error('Cannot load configured envFile'); }
  }
  if (config.forwardUrl !== undefined) {
    let url: URL;
    try { url = new URL(String(config.forwardUrl)); } catch { throw new Error('Config forwardUrl must be an absolute http(s) URL'); }
    if (typeof config.forwardUrl !== 'string' || !['http:', 'https:'].includes(url.protocol)) throw new Error('Config forwardUrl must be an absolute http(s) URL');
  }
  if (config.forwardMode !== undefined && config.forwardMode !== 'annotate' && config.forwardMode !== 'analysis-only') throw new Error('Config forwardMode must be "annotate" or "analysis-only"');
  if (config.forwardMode !== undefined && config.forwardUrl === undefined) throw new Error('Config forwardMode requires forwardUrl');
  if (config.normalizeTemplates !== undefined && typeof config.normalizeTemplates !== 'boolean') throw new Error('Config normalizeTemplates must be a boolean');
  if (config.maxModelCalls !== undefined && (!Number.isInteger(config.maxModelCalls) || Number(config.maxModelCalls) < 0 || Number(config.maxModelCalls) > 1_000_000)) throw new Error('Config maxModelCalls must be an integer from 0 to 1000000');
  if (config.suppressForMs !== undefined && (!Number.isInteger(config.suppressForMs) || Number(config.suppressForMs) < 0 || Number(config.suppressForMs) > 86_400_000)) throw new Error('Config suppressForMs must be an integer from 0 through 86400000');
  if (config.rules !== undefined) {
    try { compileRules(config.rules as Rule[]); } catch (error) { throw new Error(`Config ${error instanceof Error ? error.message : 'rules are invalid'}`); }
  }
  const { cacheSize, cacheTtlMs, ...rest } = config;
  const result: JevConfig = rest as JevConfig;
  if (cacheSize === 0) result.cache = false;
  else if (cacheSize !== undefined || cacheTtlMs !== undefined) result.cache = { ...(cacheSize === undefined ? {} : { maxEntries: cacheSize as number }), ...(cacheTtlMs === undefined ? {} : { ttlMs: cacheTtlMs as number }) };
  return result;
}

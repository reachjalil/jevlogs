import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { loadEnvFile } from 'node:process';
export interface JevConfig { port?: number; envFile?: string; retainBelow?: number; timeoutMs?: number; maxInputChars?: number }
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
  for (const key of Object.keys(config)) if (!['port','envFile','retainBelow','timeoutMs','maxInputChars'].includes(key)) throw new Error(`Unknown config option: ${key}`);
  for (const key of ['port','retainBelow','timeoutMs','maxInputChars']) if (config[key] !== undefined && (typeof config[key] !== 'number' || !Number.isFinite(config[key]))) throw new Error(`Config ${key} must be a finite number`);
  if (config.envFile !== undefined) {
    if (typeof config.envFile !== 'string' || !config.envFile.trim()) throw new Error('Config envFile must be a path');
    try { loadEnvFile(resolve(dirname(filename), config.envFile)); } catch { throw new Error('Cannot load configured envFile'); }
  }
  return config as JevConfig;
}

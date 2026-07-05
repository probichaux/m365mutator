import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

const LOG_FILE = process.env.M365MUTATOR_LOG_PATH || join(process.cwd(), 'm365mutator.log');

function formatMessage(level: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const dataStr = data ? `\n${JSON.stringify(data, null, 2)}` : '';
  return `[${timestamp}] [${level}] ${message}${dataStr}`;
}

function writeToLog(logMessage: string): void {
  try {
    appendFileSync(LOG_FILE, logMessage + '\n');
  } catch {
    // Nothing safe to do if the log file itself can't be written.
  }
}

export const logger = {
  info(message: string, data?: unknown) {
    writeToLog(formatMessage('INFO', message, data));
  },
  error(message: string, error?: unknown) {
    writeToLog(formatMessage('ERROR', message, error));
  },
  debug(message: string, data?: unknown) {
    writeToLog(formatMessage('DEBUG', message, data));
  },
  warn(message: string, data?: unknown) {
    writeToLog(formatMessage('WARN', message, data));
  },
};

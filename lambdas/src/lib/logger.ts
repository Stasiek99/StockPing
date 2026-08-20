type LogLevel = 'INFO' | 'WARN' | 'ERROR';

type Fields = Record<string, unknown>;

export interface Logger {
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, err?: unknown, fields?: Fields): void;
}

function serializeError(err: unknown): Fields {
  if (err instanceof Error) {
    return { errorName: err.name, errorMessage: err.message, stack: err.stack };
  }
  return { error: err };
}

function write(level: LogLevel, lambda: string, message: string, fields: Fields = {}): void {
  const line = JSON.stringify({ level, lambda, message, timestamp: new Date().toISOString(), ...fields });

  if (level === 'ERROR') {
    console.error(line);
  } else {
    console.log(line);
  }
}

/** One JSON line per log call, so every entry is directly queryable in CloudWatch Logs Insights. */
export function createLogger(lambda: string): Logger {
  return {
    info: (message, fields) => write('INFO', lambda, message, fields),
    warn: (message, fields) => write('WARN', lambda, message, fields),
    error: (message, err, fields) => write('ERROR', lambda, message, { ...serializeError(err), ...fields }),
  };
}

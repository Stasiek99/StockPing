import { createLogger } from '../src/lib/logger';

let logSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

test('info writes a single JSON line to stdout with the lambda name and message', () => {
  createLogger('createWatch').info('watch created', { userId: 'user-1', productId: 'prod-1' });

  expect(logSpy).toHaveBeenCalledTimes(1);
  const record = JSON.parse(logSpy.mock.calls[0][0]);

  expect(record).toMatchObject({
    level: 'INFO',
    lambda: 'createWatch',
    message: 'watch created',
    userId: 'user-1',
    productId: 'prod-1',
  });
  expect(typeof record.timestamp).toBe('string');
});

test('warn writes to stdout at WARN level', () => {
  createLogger('deleteWatch').warn('watch not found', { productId: 'prod-1' });

  expect(logSpy).toHaveBeenCalledTimes(1);
  expect(errorSpy).not.toHaveBeenCalled();
  const record = JSON.parse(logSpy.mock.calls[0][0]);
  expect(record).toMatchObject({ level: 'WARN', message: 'watch not found' });
});

test('error writes to stderr and serializes an Error into name/message/stack', () => {
  createLogger('listWatches').error('failed to list watches', new Error('boom'), { userId: 'user-1' });

  expect(errorSpy).toHaveBeenCalledTimes(1);
  const record = JSON.parse(errorSpy.mock.calls[0][0]);

  expect(record).toMatchObject({
    level: 'ERROR',
    lambda: 'listWatches',
    message: 'failed to list watches',
    userId: 'user-1',
    errorName: 'Error',
    errorMessage: 'boom',
  });
  expect(typeof record.stack).toBe('string');
});

test('error handles a non-Error rejection value without throwing', () => {
  createLogger('checkStockAndNotify').error('failed', 'a plain string reason');

  expect(errorSpy).toHaveBeenCalledTimes(1);
  const record = JSON.parse(errorSpy.mock.calls[0][0]);
  expect(record.error).toBe('a plain string reason');
});

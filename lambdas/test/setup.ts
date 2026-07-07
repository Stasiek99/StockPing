// Runs before ddb-client.ts's module-load-time env var check, so it must be a
// separate setupFiles entry rather than set inside a test file.
process.env.TABLE_NAME = 'StockPingTable-test';

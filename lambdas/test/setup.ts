// Runs before ddb-client.ts's module-load-time env var check, so it must be a
// separate setupFiles entry rather than set inside a test file.
process.env.TABLE_NAME = 'StockPingTable-test';
process.env.LEGACY_API_URL = 'https://legacy-test.example.com';
process.env.USER_POOL_ID = 'eu-west-1_testPool';
process.env.SES_FROM_EMAIL = 'notifications@stockping-test.example.com';

require('dotenv').config();
const { health, initDb } = require('./db');
(async () => {
  try {
    await initDb();
    const result = await health();
    console.log(JSON.stringify({ database: 'connected', serverTime: result.now }, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ database: 'disconnected', error: err.message }, null, 2));
    process.exit(1);
  }
})();

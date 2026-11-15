const path = require('node:path');
module.exports = {
  cacheDirectory: process.env.PUPPETEER_CACHE_DIR || path.resolve(__dirname, '../.runtime/puppeteer'),
};

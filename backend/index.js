/**
 * Entry point for Socio.io backend
 * This file simply requires the server-minimal.js file
 */
// Add this to the top of your index.js or server-minimal.js file
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  const fs = require('fs');
  fs.writeFileSync(
    '/tmp/google-credentials.json',
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
  );
  process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/google-credentials.json';
}

// Require the minimal server file
require('./server-minimal.js');
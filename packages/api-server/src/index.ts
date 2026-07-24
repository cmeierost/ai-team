import { startServer } from './server.js';
import { writeServerError } from './server-log.js';

// Start server with options from environment
startServer().catch((error) => {
  writeServerError(error, { phase: 'startup' });
  console.error('Failed to start server:', error);
  process.exit(1);
});

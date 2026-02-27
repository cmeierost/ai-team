import { startServer } from './server.js';

// Start server with options from environment
startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

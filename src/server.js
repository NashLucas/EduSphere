import http from 'http';
import app from './app.js';
import {
  claimShutdown,
  connectDatabase,
  disconnectDatabase,
} from './database/index.js';

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

// This process has an HTTP server to drain, so it owns the teardown order:
// stop accepting connections, let in-flight requests finish, and only then
// close the connection pool. Without this the singleton's own fallback handler
// would also fire and could close the pool underneath a live request.
// Task 2.8 replaces this bootstrap with the full sequence — Redis included,
// and a 10-second drain timeout.
claimShutdown();

async function startServer() {
  try {
    // Fail at boot on an unreachable database rather than on the first request
    // that needs data. connectDatabase() logs the target itself.
    await connectDatabase();

    // Start listening
    server.listen(PORT, () => {
      console.info(
        `Server running in ${process.env.NODE_ENV} mode on port ${PORT}`,
      );
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
function gracefulShutdown(signal) {
  console.info(`Received ${signal}, shutting down gracefully...`);
  server.close(async () => {
    await disconnectDatabase();
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

startServer();

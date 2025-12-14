'use strict';

const cluster = require('cluster');
const os = require('os');
const configManager = require('./config/configManager');

if (cluster.isPrimary) {
  const config = configManager.load();
  const numWorkers = config.scalability?.workers || 1;
  
  console.log(`🐧 RoarinAPI Cluster Master starting with ${numWorkers} workers`);
  
  // Fork workers
  for (let i = 0; i < numWorkers; i++) {
    const worker = cluster.fork({ WORKER_ID: i });
    console.log(`  Worker ${worker.process.pid} started`);
  }
  
  // Handle worker exits
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
    cluster.fork({ WORKER_ID: worker.id });
  });
  
  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    for (const id in cluster.workers) {
      cluster.workers[id].process.kill('SIGTERM');
    }
  });
  
} else {
  // Worker process
  const { start } = require('./server');
  
  // Each worker listens on a different port if needed for NGINX upstream
  const basePort = parseInt(process.env.PORT || 4242);
  const workerId = parseInt(process.env.WORKER_ID || 0);
  
  // In single-port mode, all workers share the same port (Node.js handles this)
  // In multi-port mode (for NGINX upstream), each worker gets its own port
  const multiPortMode = process.env.MULTI_PORT === 'true';
  
  if (multiPortMode) {
    process.env.PORT = basePort + workerId;
  }
  
  start().then(() => {
    console.log(`  Worker ${process.pid} listening on port ${process.env.PORT || basePort}`);
  });
}

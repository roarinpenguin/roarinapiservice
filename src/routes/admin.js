'use strict';

const configManager = require('../config/configManager');
const { exec } = require('child_process');

async function adminRoutes(fastify, options) {
  
  // Check setup status
  fastify.get('/setup-status', async (request, reply) => {
    return { 
      setupComplete: fastify.isSetupComplete(),
      authenticated: fastify.validateSession(request.cookies?.sessionToken)
    };
  });
  
  // Initial setup
  fastify.post('/setup', async (request, reply) => {
    if (fastify.isSetupComplete()) {
      return reply.code(400).send({ error: 'Setup already complete' });
    }
    
    const { password } = request.body;
    if (!password || password.length < 8) {
      return reply.code(400).send({ error: 'Password must be at least 8 characters' });
    }
    
    fastify.setupPassword(password);
    const token = fastify.login(password);
    
    reply.setCookie('sessionToken', token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 // 24 hours
    });
    
    return { success: true };
  });
  
  // Login
  fastify.post('/login', async (request, reply) => {
    const { password } = request.body;
    const token = fastify.login(password);
    
    if (!token) {
      return reply.code(401).send({ error: 'Invalid password' });
    }
    
    reply.setCookie('sessionToken', token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60
    });
    
    return { success: true };
  });
  
  // Logout
  fastify.post('/logout', async (request, reply) => {
    const token = request.cookies?.sessionToken;
    if (token) {
      fastify.logout(token);
    }
    reply.clearCookie('sessionToken', { path: '/' });
    return { success: true };
  });
  
  // Change password
  fastify.post('/change-password', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const { currentPassword, newPassword } = request.body;
    
    if (!newPassword || newPassword.length < 8) {
      return reply.code(400).send({ error: 'New password must be at least 8 characters' });
    }
    
    const success = fastify.changePassword(currentPassword, newPassword);
    if (!success) {
      return reply.code(401).send({ error: 'Current password is incorrect' });
    }
    
    reply.clearCookie('sessionToken', { path: '/' });
    return { success: true, message: 'Password changed. Please login again.' };
  });
  
  // ===== ENDPOINTS MANAGEMENT =====
  
  // List all endpoints
  fastify.get('/endpoints', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const endpoints = configManager.loadEndpoints();
    return { endpoints };
  });
  
  // Get single endpoint
  fastify.get('/endpoints/:id', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const endpoint = configManager.getEndpoint(request.params.id);
    if (!endpoint) {
      return reply.code(404).send({ error: 'Endpoint not found' });
    }
    return { endpoint };
  });
  
  // Create endpoint
  fastify.post('/endpoints', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const { path, method, description, protected: isProtected, token, parameterSource, parameters, responseType, responses, enabled } = request.body;
    
    if (!path || !method) {
      return reply.code(400).send({ error: 'Path and method are required' });
    }
    
    // Validate path format
    if (!path.startsWith('/')) {
      return reply.code(400).send({ error: 'Path must start with /' });
    }
    
    // Check for reserved paths
    const reservedPaths = ['/admin', '/api/admin', '/health'];
    if (reservedPaths.some(p => path.startsWith(p))) {
      return reply.code(400).send({ error: 'Path is reserved' });
    }
    
    const endpoint = configManager.createEndpoint({
      path,
      method: method.toUpperCase(),
      description: description || '',
      protected: isProtected || false,
      token: token || null,
      parameterSource: parameterSource || 'none',
      parameters: parameters || [],
      responseType: responseType || 'json',
      responses: responses || [{ condition: null, data: {} }],
      enabled: enabled !== false
    });
    
    return { endpoint };
  });
  
  // Update endpoint
  fastify.put('/endpoints/:id', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const endpoint = configManager.updateEndpoint(request.params.id, request.body);
    if (!endpoint) {
      return reply.code(404).send({ error: 'Endpoint not found' });
    }
    return { endpoint };
  });
  
  // Delete endpoint
  fastify.delete('/endpoints/:id', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const success = configManager.deleteEndpoint(request.params.id);
    if (!success) {
      return reply.code(404).send({ error: 'Endpoint not found' });
    }
    return { success: true };
  });
  
  // ===== ASSETS MANAGEMENT =====
  
  // Upload asset
  fastify.post('/assets', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }
    
    const buffer = await data.toBuffer();
    const asset = configManager.saveAsset(data.filename, buffer);
    
    return { asset };
  });
  
  // Delete asset
  fastify.delete('/assets/:id', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const success = configManager.deleteAsset(request.params.id);
    if (!success) {
      return reply.code(404).send({ error: 'Asset not found' });
    }
    return { success: true };
  });
  
  // ===== SCALABILITY =====
  
  // Get scalability settings
  fastify.get('/scalability', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const scalability = configManager.getScalability();
    const resources = configManager.estimateResources(scalability);
    return { scalability, resources };
  });
  
  // Update scalability settings
  fastify.put('/scalability', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const { workers, maxConnections, connectionTimeout, keepAliveTimeout } = request.body;
    
    const updates = {};
    if (workers !== undefined) updates.workers = Math.max(1, Math.min(16, parseInt(workers)));
    if (maxConnections !== undefined) updates.maxConnections = Math.max(100, Math.min(10000, parseInt(maxConnections)));
    if (connectionTimeout !== undefined) updates.connectionTimeout = parseInt(connectionTimeout);
    if (keepAliveTimeout !== undefined) updates.keepAliveTimeout = parseInt(keepAliveTimeout);
    
    const scalability = configManager.updateScalability(updates);
    const resources = configManager.estimateResources(scalability);
    
    return { scalability, resources, nginxReloadRequired: true };
  });
  
  // Generate NGINX config
  fastify.get('/nginx-config', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const scalability = configManager.getScalability();
    const config = generateNginxConfig(scalability);
    return { config };
  });
  
  // ===== EXPORT/IMPORT =====
  
  // Export configuration
  fastify.get('/export', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const data = configManager.exportConfig();
    
    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', 'attachment; filename="roarinapi-config.json"');
    
    return data;
  });
  
  // Import configuration
  fastify.post('/import', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    try {
      const data = request.body;
      
      if (!data || (!data.endpoints && !data.config)) {
        return reply.code(400).send({ error: 'Invalid configuration format' });
      }
      
      configManager.importConfig(data);
      
      return { success: true, message: 'Configuration imported successfully' };
    } catch (err) {
      return reply.code(400).send({ error: 'Failed to import configuration: ' + err.message });
    }
  });
  
  // ===== SYSTEM INFO =====
  
  fastify.get('/system-info', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const config = configManager.load();
    const scalability = configManager.getScalability();
    const resources = configManager.estimateResources(scalability);
    const endpoints = configManager.loadEndpoints();
    
    return {
      version: '1.0.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      port: config.port || process.env.PORT || 4242,
      endpoints: {
        total: endpoints.length,
        enabled: endpoints.filter(e => e.enabled).length,
        protected: endpoints.filter(e => e.protected).length
      },
      scalability,
      resources
    };
  });
  
  // ===== SERVER CONTROL =====
  
  // Get current port
  fastify.get('/server-config', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const config = configManager.load();
    return {
      port: config.port || process.env.PORT || 4242,
      currentPort: process.env.PORT || 4242
    };
  });
  
  // Change server port (requires restart)
  fastify.post('/server-config', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const { port } = request.body;
    
    if (!port || port < 1024 || port > 65535) {
      return reply.code(400).send({ error: 'Port must be between 1024 and 65535' });
    }
    
    const config = configManager.load();
    config.port = parseInt(port);
    configManager.save(config);
    
    return { 
      success: true, 
      port: config.port,
      message: 'Port configuration saved. Server restart required.',
      restartRequired: true
    };
  });
  
  // Restart server (graceful)
  fastify.post('/server-restart', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    // Send response first, then restart
    reply.send({ success: true, message: 'Server restarting...' });
    
    // Delay restart to allow response to be sent
    setTimeout(() => {
      console.log('🐧 Server restart requested via admin UI');
      process.exit(0); // Docker/PM2 will restart the process
    }, 500);
  });
  
  // Reload NGINX configuration
  fastify.post('/nginx-reload', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    return new Promise((resolve) => {
      // Try multiple methods to reload NGINX
      const commands = [
        'nginx -s reload',                           // Direct NGINX reload
        'docker exec roarinapi-nginx nginx -s reload', // Docker container
        'service nginx reload',                      // Service manager
        '/etc/init.d/nginx reload'                   // Init script
      ];
      
      const tryCommand = (index) => {
        if (index >= commands.length) {
          resolve({ 
            success: false, 
            error: 'Could not reload NGINX. Make sure NGINX is running and accessible.',
            hint: 'In Docker, ensure the nginx container is named "roarinapi-nginx" or reload manually.'
          });
          return;
        }
        
        exec(commands[index], (error, stdout, stderr) => {
          if (!error) {
            resolve({ success: true, message: 'NGINX reloaded successfully', command: commands[index] });
          } else {
            tryCommand(index + 1);
          }
        });
      };
      
      tryCommand(0);
    });
  });
  
  // Check NGINX status
  fastify.get('/nginx-status', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    return new Promise((resolve) => {
      exec('nginx -t 2>&1 || docker exec roarinapi-nginx nginx -t 2>&1', (error, stdout, stderr) => {
        if (!error) {
          resolve({ running: true, configValid: true, output: stdout || stderr });
        } else {
          resolve({ running: false, configValid: false, error: stderr || stdout });
        }
      });
    });
  });
}

// Generate NGINX configuration
function generateNginxConfig(scalability) {
  return `# RoarinAPI NGINX Configuration
# Generated automatically - do not edit manually

worker_processes ${scalability.workers};

events {
    worker_connections ${Math.ceil(scalability.maxConnections / scalability.workers)};
    multi_accept on;
    use epoll;
}

http {
    upstream roarinapi {
        least_conn;
        keepalive 32;
${Array.from({ length: scalability.workers }, (_, i) => 
        `        server 127.0.0.1:${4242 + i} weight=1;`
).join('\n')}
    }

    server {
        listen 80;
        server_name _;

        # Connection limits
        limit_conn_zone $binary_remote_addr zone=conn_limit:10m;
        limit_conn conn_limit ${Math.ceil(scalability.maxConnections / 100)};

        # Timeouts
        proxy_connect_timeout ${scalability.connectionTimeout}ms;
        proxy_send_timeout ${scalability.connectionTimeout}ms;
        proxy_read_timeout ${scalability.connectionTimeout}ms;
        keepalive_timeout ${scalability.keepAliveTimeout}ms;

        location / {
            proxy_pass http://roarinapi;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }

        # Health check endpoint
        location /health {
            proxy_pass http://roarinapi/health;
            access_log off;
        }
    }
}
`;
}

module.exports = adminRoutes;

'use strict';

const configManager = require('../config/configManager');
const path = require('path');
const fs = require('fs');

async function dynamicRoutes(fastify, options) {
  
  // Wildcard route handler for all dynamic endpoints
  fastify.all('/*', async (request, reply) => {
    const requestPath = request.url.split('?')[0]; // Remove query string
    const method = request.method;
    
    // Skip admin routes
    if (requestPath.startsWith('/admin') || requestPath.startsWith('/api/admin') || requestPath === '/health') {
      return reply.code(404).send({ error: 'Not found' });
    }
    
    const endpoints = configManager.loadEndpoints();
    
    // Find matching endpoint
    const endpoint = endpoints.find(e => 
      e.enabled && 
      e.path === requestPath && 
      (e.method === method || e.method === 'ANY')
    );
    
    if (!endpoint) {
      return reply.code(404).send({ error: 'Endpoint not found' });
    }
    
    // Check authentication if protected
    if (endpoint.protected) {
      const authHeader = request.headers['authorization'];
      if (!authHeader) {
        return reply.code(401).send({ error: 'Authorization required' });
      }
      
      const token = authHeader.replace('Bearer ', '');
      if (token !== endpoint.token) {
        return reply.code(401).send({ error: 'Invalid token' });
      }
    }
    
    // Collect parameters based on source
    let params = {};
    
    switch (endpoint.parameterSource) {
      case 'query':
        params = { ...request.query };
        break;
      case 'header':
        params = { ...request.headers };
        break;
      case 'body':
        params = request.body || {};
        break;
      case 'mixed':
        params = {
          query: request.query,
          headers: request.headers,
          body: request.body || {}
        };
        break;
      default:
        params = {};
    }
    
    // Validate required parameters
    if (endpoint.parameters && endpoint.parameters.length > 0) {
      for (const param of endpoint.parameters) {
        if (param.required) {
          let value;
          if (endpoint.parameterSource === 'mixed') {
            value = params.query?.[param.name] || params.headers?.[param.name.toLowerCase()] || params.body?.[param.name];
          } else if (endpoint.parameterSource === 'header') {
            value = params[param.name.toLowerCase()];
          } else {
            value = params[param.name];
          }
          
          if (value === undefined || value === null || value === '') {
            return reply.code(400).send({ 
              error: `Missing required parameter: ${param.name}`,
              source: endpoint.parameterSource
            });
          }
        }
      }
    }
    
    // Find matching response based on conditions
    let responseData = null;
    
    if (endpoint.responses && endpoint.responses.length > 0) {
      // Try to find conditional response first
      for (const resp of endpoint.responses) {
        if (resp.condition) {
          try {
            if (evaluateCondition(resp.condition, params, request)) {
              responseData = resp;
              break;
            }
          } catch (e) {
            // Condition evaluation failed, skip
          }
        }
      }
      
      // Fall back to default response (no condition)
      if (!responseData) {
        responseData = endpoint.responses.find(r => !r.condition) || endpoint.responses[0];
      }
    }
    
    if (!responseData) {
      return reply.code(500).send({ error: 'No response configured' });
    }
    
    // Process response based on type
    switch (endpoint.responseType) {
      case 'json':
        const jsonData = processTemplateVariables(responseData.data, params, request);
        return reply.send(jsonData);
        
      case 'text':
        const textResponse = responseData.text || responseData.data || '';
        reply.header('Content-Type', 'text/plain');
        return reply.send(processTemplateString(String(textResponse), params, request));
        
      case 'binary':
      case 'image':
        // Handle assetPath (new format from UI upload)
        if (responseData.assetPath) {
          const assetFullPath = path.join(configManager.ASSETS_DIR, responseData.assetPath);
          if (!fs.existsSync(assetFullPath)) {
            return reply.code(404).send({ error: 'Asset file not found' });
          }
          const buffer = fs.readFileSync(assetFullPath);
          reply.header('Content-Type', responseData.contentType || 'application/octet-stream');
          if (responseData.fileName) {
            reply.header('Content-Disposition', `inline; filename="${responseData.fileName}"`);
          }
          return reply.send(buffer);
        }
        // Handle assetId (legacy format)
        if (responseData.assetId) {
          const asset = configManager.getAsset(responseData.assetId);
          if (!asset) {
            return reply.code(404).send({ error: 'Asset not found' });
          }
          
          // Determine content type
          const ext = path.extname(asset.path).toLowerCase();
          const contentTypes = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml',
            '.pdf': 'application/pdf',
            '.zip': 'application/zip',
            '.bin': 'application/octet-stream'
          };
          
          reply.header('Content-Type', contentTypes[ext] || 'application/octet-stream');
          return reply.send(asset.buffer);
        } else if (responseData.base64) {
          const buffer = Buffer.from(responseData.base64, 'base64');
          reply.header('Content-Type', responseData.contentType || 'application/octet-stream');
          return reply.send(buffer);
        }
        return reply.code(500).send({ error: 'Binary response not configured properly' });
        
      case 'redirect':
        return reply.redirect(responseData.redirectUrl || responseData.url || '/');
        
      default:
        return reply.send(responseData.data);
    }
  });
}

// Evaluate condition string
function evaluateCondition(condition, params, request) {
  // Simple condition evaluator
  // Supports: param.name == 'value', param.name != 'value', param.name > 0, etc.
  
  const context = {
    query: request.query || {},
    headers: request.headers || {},
    body: request.body || {},
    params: params,
    method: request.method
  };
  
  // Replace variables in condition
  let evalCondition = condition;
  
  // Replace query.xxx
  evalCondition = evalCondition.replace(/query\.(\w+)/g, (match, key) => {
    const val = context.query[key];
    return typeof val === 'string' ? `"${val}"` : val;
  });
  
  // Replace headers.xxx
  evalCondition = evalCondition.replace(/headers\.(\w+)/g, (match, key) => {
    const val = context.headers[key.toLowerCase()];
    return typeof val === 'string' ? `"${val}"` : val;
  });
  
  // Replace body.xxx
  evalCondition = evalCondition.replace(/body\.(\w+)/g, (match, key) => {
    const val = context.body[key];
    return typeof val === 'string' ? `"${val}"` : JSON.stringify(val);
  });
  
  // Replace params.xxx
  evalCondition = evalCondition.replace(/params\.(\w+)/g, (match, key) => {
    const val = params[key];
    return typeof val === 'string' ? `"${val}"` : val;
  });
  
  // Simple safe evaluation (only allows comparisons)
  const safePattern = /^[\s\d"'=!<>&|().]+$/;
  if (!safePattern.test(evalCondition.replace(/\w+/g, ''))) {
    throw new Error('Invalid condition');
  }
  
  try {
    return new Function(`return ${evalCondition}`)();
  } catch (e) {
    return false;
  }
}

// Process template variables in JSON data
function processTemplateVariables(data, params, request) {
  if (typeof data === 'string') {
    return processTemplateString(data, params, request);
  }
  
  if (Array.isArray(data)) {
    return data.map(item => processTemplateVariables(item, params, request));
  }
  
  if (typeof data === 'object' && data !== null) {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = processTemplateVariables(value, params, request);
    }
    return result;
  }
  
  return data;
}

// Process template string
function processTemplateString(str, params, request) {
  if (typeof str !== 'string') return str;
  
  return str
    .replace(/\{\{timestamp\}\}/g, new Date().toISOString())
    .replace(/\{\{date\}\}/g, new Date().toISOString().split('T')[0])
    .replace(/\{\{time\}\}/g, new Date().toISOString().split('T')[1])
    .replace(/\{\{method\}\}/g, request.method)
    .replace(/\{\{path\}\}/g, request.url)
    .replace(/\{\{body\}\}/g, JSON.stringify(request.body || {}))
    .replace(/\{\{query\.(\w+)\}\}/g, (match, key) => request.query?.[key] || '')
    .replace(/\{\{headers\.(\w+)\}\}/g, (match, key) => request.headers?.[key.toLowerCase()] || '')
    .replace(/\{\{params\.(\w+)\}\}/g, (match, key) => params?.[key] || '')
    .replace(/\{\{body\.(\w+)\}\}/g, (match, key) => {
      const val = request.body?.[key];
      return typeof val === 'object' ? JSON.stringify(val) : (val || '');
    });
}

module.exports = dynamicRoutes;

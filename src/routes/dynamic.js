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
          const assetFullPath = configManager.resolveAssetPath(responseData.assetPath);
          if (!assetFullPath || !fs.existsSync(assetFullPath)) {
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

// Evaluate a condition string safely.
//
// Supports the documented syntax — query.x == 'v', headers.x != 'v',
// body.x > 0, params.x, method, string/number/boolean/null literals, the
// comparison operators == != > < >= <=, logical && || and ! and parentheses.
//
// SECURITY: conditions are parsed into an AST and evaluated against the request
// context. Request values are looked up as data — they are NEVER interpolated
// into an evaluated string. This intentionally does not use eval()/new Function()
// so no request input (query/header/body) can ever be executed as code.
function evaluateCondition(condition, params, request) {
  if (typeof condition !== 'string' || condition.trim() === '') return false;

  const context = {
    query: request.query || {},
    headers: request.headers || {},
    body: request.body || {},
    params: params || {},
    method: request.method
  };

  let ast;
  try {
    ast = parseConditionExpression(tokenizeCondition(condition));
  } catch (e) {
    // Malformed / unsupported condition -> treat as non-match. Never execute it.
    return false;
  }

  try {
    return isTruthy(ast(context));
  } catch (e) {
    return false;
  }
}

// --- Safe condition engine (tokenizer + recursive-descent parser) ---

function tokenizeCondition(input) {
  const tokens = [];
  let i = 0;
  const isIdentStart = (c) => /[A-Za-z_]/.test(c);
  // '-' is permitted inside identifiers so header names like "x-flag" resolve.
  // This is unambiguous because subtraction is not a supported operator and a
  // leading '-' before a digit is tokenized as a negative number literal first.
  const isIdentChar = (c) => /[A-Za-z0-9_.-]/.test(c);

  while (i < input.length) {
    const c = input[i];

    if (/\s/.test(c)) { i++; continue; }

    // String literal (single or double quoted), with backslash escaping
    if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      let str = '';
      while (j < input.length && input[j] !== quote) {
        if (input[j] === '\\' && j + 1 < input.length) { str += input[j + 1]; j += 2; continue; }
        str += input[j];
        j++;
      }
      if (j >= input.length) throw new Error('Unterminated string literal');
      tokens.push({ type: 'string', value: str });
      i = j + 1;
      continue;
    }

    // Number literal (optionally negative)
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(input[i + 1] || ''))) {
      let j = i + (c === '-' ? 1 : 0);
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      tokens.push({ type: 'number', value: parseFloat(input.slice(i, j)) });
      i = j;
      continue;
    }

    // Two-character operators
    const two = input.slice(i, i + 2);
    if (['==', '!=', '>=', '<=', '&&', '||'].includes(two)) {
      tokens.push({ type: 'op', value: two });
      i += 2;
      continue;
    }

    // Single-character operators / parens
    if (c === '>' || c === '<' || c === '!') { tokens.push({ type: 'op', value: c }); i++; continue; }
    if (c === '(' || c === ')') { tokens.push({ type: 'paren', value: c }); i++; continue; }

    // Identifier (variable path or keyword)
    if (isIdentStart(c)) {
      let j = i;
      while (j < input.length && isIdentChar(input[j])) j++;
      tokens.push({ type: 'ident', value: input.slice(i, j) });
      i = j;
      continue;
    }

    throw new Error('Unexpected character in condition: ' + c);
  }

  return tokens;
}

function parseConditionExpression(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const nextTok = () => tokens[pos++];

  function parseOr() {
    let left = parseAnd();
    while (peek() && peek().type === 'op' && peek().value === '||') {
      nextTok();
      const right = parseAnd();
      const l = left;
      left = (ctx) => isTruthy(l(ctx)) || isTruthy(right(ctx));
    }
    return left;
  }

  function parseAnd() {
    let left = parseComparison();
    while (peek() && peek().type === 'op' && peek().value === '&&') {
      nextTok();
      const right = parseComparison();
      const l = left;
      left = (ctx) => isTruthy(l(ctx)) && isTruthy(right(ctx));
    }
    return left;
  }

  function parseComparison() {
    const left = parseUnary();
    const t = peek();
    if (t && t.type === 'op' && ['==', '!=', '>', '<', '>=', '<='].includes(t.value)) {
      nextTok();
      const right = parseUnary();
      const op = t.value;
      return (ctx) => compareValues(op, left(ctx), right(ctx));
    }
    return left;
  }

  function parseUnary() {
    const t = peek();
    if (t && t.type === 'op' && t.value === '!') {
      nextTok();
      const operand = parseUnary();
      return (ctx) => !isTruthy(operand(ctx));
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const t = nextTok();
    if (!t) throw new Error('Unexpected end of condition');

    if (t.type === 'paren' && t.value === '(') {
      const expr = parseOr();
      const close = nextTok();
      if (!close || close.type !== 'paren' || close.value !== ')') throw new Error('Expected )');
      return expr;
    }

    if (t.type === 'string') return () => t.value;
    if (t.type === 'number') return () => t.value;

    if (t.type === 'ident') {
      if (t.value === 'true') return () => true;
      if (t.value === 'false') return () => false;
      if (t.value === 'null') return () => null;
      return (ctx) => resolveConditionVariable(t.value, ctx);
    }

    throw new Error('Unexpected token in condition: ' + t.value);
  }

  const ast = parseOr();
  if (pos < tokens.length) throw new Error('Unexpected trailing tokens in condition');
  return ast;
}

// Resolve a dotted variable path (query.x, headers.x, body.x, params.x, method)
// against the request context. Only these known roots are allowed.
function resolveConditionVariable(name, ctx) {
  const dot = name.indexOf('.');
  const root = dot === -1 ? name : name.slice(0, dot);
  const key = dot === -1 ? '' : name.slice(dot + 1);

  switch (root) {
    case 'query': return ctx.query ? ctx.query[key] : undefined;
    case 'headers': return ctx.headers ? ctx.headers[key.toLowerCase()] : undefined;
    case 'body': return ctx.body ? ctx.body[key] : undefined;
    case 'params': return ctx.params ? ctx.params[key] : undefined;
    case 'method': return ctx.method;
    default: return undefined;
  }
}

function toComparableNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
  return null;
}

function compareValues(op, a, b) {
  const na = toComparableNumber(a);
  const nb = toComparableNumber(b);
  const bothNumeric = na !== null && nb !== null;

  switch (op) {
    case '==': return bothNumeric ? na === nb : String(a) === String(b);
    case '!=': return bothNumeric ? na !== nb : String(a) !== String(b);
    case '>': return bothNumeric ? na > nb : String(a) > String(b);
    case '<': return bothNumeric ? na < nb : String(a) < String(b);
    case '>=': return bothNumeric ? na >= nb : String(a) >= String(b);
    case '<=': return bothNumeric ? na <= nb : String(a) <= String(b);
    default: return false;
  }
}

function isTruthy(v) {
  if (v === undefined || v === null || v === false) return false;
  if (v === '' || v === 0) return false;
  return true;
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
// Exposed for unit testing of the safe condition engine.
module.exports.evaluateCondition = evaluateCondition;

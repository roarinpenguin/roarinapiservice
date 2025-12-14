'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ENDPOINTS_FILE = path.join(DATA_DIR, 'endpoints.json');
const ASSETS_DIR = path.join(DATA_DIR, 'assets');

// Ensure directories exist
function ensureDirectories() {
  [DATA_DIR, ASSETS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

// Default configuration
const defaultConfig = {
  adminPasswordHash: null,
  sessionSecret: crypto.randomBytes(32).toString('hex'),
  scalability: {
    workers: 1,
    maxConnections: 1000,
    connectionTimeout: 30000,
    keepAliveTimeout: 5000
  },
  logLevel: 'info'
};

// Default endpoints (migrated from original)
const defaultEndpoints = [
  {
    id: crypto.randomUUID(),
    path: '/ping',
    method: 'GET',
    description: 'Health check endpoint',
    protected: false,
    token: null,
    parameterSource: 'none',
    parameters: [],
    responseType: 'json',
    responses: [
      {
        condition: null,
        data: { message: 'pong' }
      }
    ],
    enabled: true,
    createdAt: new Date().toISOString()
  },
  {
    id: crypto.randomUUID(),
    path: '/status',
    method: 'GET',
    description: 'API status endpoint',
    protected: false,
    token: null,
    parameterSource: 'none',
    parameters: [],
    responseType: 'json',
    responses: [
      {
        condition: null,
        data: { status: 'ok', time: '{{timestamp}}' }
      }
    ],
    enabled: true,
    createdAt: new Date().toISOString()
  },
  {
    id: crypto.randomUUID(),
    path: '/carlist',
    method: 'GET',
    description: 'Returns a list of cars',
    protected: true,
    token: 'let-th3PenguinR0ar!',
    parameterSource: 'none',
    parameters: [],
    responseType: 'json',
    responses: [
      {
        condition: null,
        data: [
          { manufacturer: 'Ford', model: 'Mustang GT500' },
          { manufacturer: 'Koenigsegg', model: 'Agera R' },
          { manufacturer: 'McLaren', model: 'P1' },
          { manufacturer: 'Lamborghini', model: 'Sesto Elemento' },
          { manufacturer: 'Bugatti', model: 'Veyron Super Sport' },
          { manufacturer: 'GTA', model: 'Spano' },
          { manufacturer: 'Saleen', model: 'S7' },
          { manufacturer: 'Chevrolet', model: 'Camaro' },
          { manufacturer: 'Dodge', model: 'Charger SRT8' },
          { manufacturer: 'Plymouth', model: 'Barracuda' }
        ]
      }
    ],
    enabled: true,
    createdAt: new Date().toISOString()
  },
  {
    id: crypto.randomUUID(),
    path: '/echo',
    method: 'POST',
    description: 'Echoes back posted JSON',
    protected: true,
    token: 'let-th3PenguinR0ar!',
    parameterSource: 'body',
    parameters: [],
    responseType: 'json',
    responses: [
      {
        condition: null,
        data: { echo: '{{body}}' }
      }
    ],
    enabled: true,
    createdAt: new Date().toISOString()
  }
];

// Load configuration
function load() {
  ensureDirectories();
  
  if (!fs.existsSync(CONFIG_FILE)) {
    save(defaultConfig);
    return { ...defaultConfig };
  }
  
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    return { ...defaultConfig, ...JSON.parse(data) };
  } catch (err) {
    console.error('Error loading config:', err);
    return { ...defaultConfig };
  }
}

// Save configuration
function save(config) {
  ensureDirectories();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Load endpoints
function loadEndpoints() {
  ensureDirectories();
  
  if (!fs.existsSync(ENDPOINTS_FILE)) {
    saveEndpoints(defaultEndpoints);
    return [...defaultEndpoints];
  }
  
  try {
    const data = fs.readFileSync(ENDPOINTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error loading endpoints:', err);
    return [...defaultEndpoints];
  }
}

// Save endpoints
function saveEndpoints(endpoints) {
  ensureDirectories();
  fs.writeFileSync(ENDPOINTS_FILE, JSON.stringify(endpoints, null, 2));
}

// Get single endpoint
function getEndpoint(id) {
  const endpoints = loadEndpoints();
  return endpoints.find(e => e.id === id);
}

// Create endpoint
function createEndpoint(endpoint) {
  const endpoints = loadEndpoints();
  const newEndpoint = {
    id: crypto.randomUUID(),
    ...endpoint,
    createdAt: new Date().toISOString()
  };
  endpoints.push(newEndpoint);
  saveEndpoints(endpoints);
  return newEndpoint;
}

// Update endpoint
function updateEndpoint(id, updates) {
  const endpoints = loadEndpoints();
  const index = endpoints.findIndex(e => e.id === id);
  if (index === -1) return null;
  
  endpoints[index] = { ...endpoints[index], ...updates, updatedAt: new Date().toISOString() };
  saveEndpoints(endpoints);
  return endpoints[index];
}

// Delete endpoint
function deleteEndpoint(id) {
  const endpoints = loadEndpoints();
  const index = endpoints.findIndex(e => e.id === id);
  if (index === -1) return false;
  
  endpoints.splice(index, 1);
  saveEndpoints(endpoints);
  return true;
}

// Asset management
function saveAsset(filename, buffer) {
  ensureDirectories();
  const assetId = crypto.randomUUID();
  const ext = path.extname(filename);
  const assetPath = path.join(ASSETS_DIR, `${assetId}${ext}`);
  fs.writeFileSync(assetPath, buffer);
  return { id: assetId, filename, path: assetPath, ext };
}

function getAsset(assetId) {
  const files = fs.readdirSync(ASSETS_DIR);
  const assetFile = files.find(f => f.startsWith(assetId));
  if (!assetFile) return null;
  return {
    path: path.join(ASSETS_DIR, assetFile),
    buffer: fs.readFileSync(path.join(ASSETS_DIR, assetFile))
  };
}

function deleteAsset(assetId) {
  const files = fs.readdirSync(ASSETS_DIR);
  const assetFile = files.find(f => f.startsWith(assetId));
  if (assetFile) {
    fs.unlinkSync(path.join(ASSETS_DIR, assetFile));
    return true;
  }
  return false;
}

// Export all configuration
function exportConfig() {
  const config = load();
  const endpoints = loadEndpoints();
  
  // Read all assets as base64
  const assets = {};
  if (fs.existsSync(ASSETS_DIR)) {
    const files = fs.readdirSync(ASSETS_DIR);
    files.forEach(file => {
      const buffer = fs.readFileSync(path.join(ASSETS_DIR, file));
      assets[file] = buffer.toString('base64');
    });
  }
  
  return {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    config: { ...config, adminPasswordHash: undefined, sessionSecret: undefined },
    endpoints,
    assets
  };
}

// Import configuration
function importConfig(data) {
  ensureDirectories();
  
  if (data.config) {
    const currentConfig = load();
    save({
      ...currentConfig,
      scalability: data.config.scalability || currentConfig.scalability,
      logLevel: data.config.logLevel || currentConfig.logLevel
    });
  }
  
  if (data.endpoints) {
    saveEndpoints(data.endpoints);
  }
  
  if (data.assets) {
    Object.entries(data.assets).forEach(([filename, base64]) => {
      const buffer = Buffer.from(base64, 'base64');
      fs.writeFileSync(path.join(ASSETS_DIR, filename), buffer);
    });
  }
  
  return true;
}

// Scalability helpers
function updateScalability(settings) {
  const config = load();
  config.scalability = { ...config.scalability, ...settings };
  save(config);
  return config.scalability;
}

function getScalability() {
  const config = load();
  return config.scalability;
}

// Resource estimation
function estimateResources(scalability) {
  const baseMemory = 50; // Base Node.js memory in MB
  const perWorkerMemory = 40; // Additional memory per worker
  const perConnectionMemory = 0.05; // Memory per connection in MB
  
  const workers = scalability.workers || 1;
  const maxConnections = scalability.maxConnections || 1000;
  
  const estimatedMemory = baseMemory + (workers * perWorkerMemory) + (maxConnections * perConnectionMemory);
  const estimatedCPU = workers * 0.25; // Estimated CPU cores
  
  return {
    memory: {
      estimated: Math.ceil(estimatedMemory),
      recommended: Math.ceil(estimatedMemory * 1.5),
      unit: 'MB'
    },
    cpu: {
      estimated: estimatedCPU,
      recommended: Math.ceil(estimatedCPU * 1.5 * 10) / 10,
      unit: 'cores'
    },
    throughput: {
      estimated: workers * 500,
      unit: 'requests/sec'
    },
    concurrency: {
      max: maxConnections,
      perWorker: Math.ceil(maxConnections / workers)
    }
  };
}

module.exports = {
  load,
  save,
  loadEndpoints,
  saveEndpoints,
  getEndpoint,
  createEndpoint,
  updateEndpoint,
  deleteEndpoint,
  saveAsset,
  getAsset,
  deleteAsset,
  exportConfig,
  importConfig,
  updateScalability,
  getScalability,
  estimateResources,
  DATA_DIR,
  ASSETS_DIR
};

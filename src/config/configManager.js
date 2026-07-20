'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ENDPOINTS_FILE = path.join(DATA_DIR, 'endpoints.json');
const ASSETS_DIR = path.join(DATA_DIR, 'assets');

// Blueprint image: served by the default /blueprint endpoint, always stored as blueprint.png.
// The built-in default ships in src/assets and is seeded into the data volume on first run.
const BLUEPRINT_FILENAME = 'blueprint.png';
const BLUEPRINT_FILE = path.join(ASSETS_DIR, BLUEPRINT_FILENAME);
const DEFAULT_BLUEPRINT_SEED = path.join(__dirname, '../assets', BLUEPRINT_FILENAME);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Ensure directories exist
function ensureDirectories() {
  [DATA_DIR, ASSETS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

// --- Read cache + atomic writes ---------------------------------------------
// config.json / endpoints.json were previously read + JSON.parsed on EVERY
// request (see dynamic.js). We cache the parsed value keyed by file mtime, so
// the hot path does a single stat() instead of a full read+parse. On shared
// storage (EFS) this stays correct across instances: when another node writes
// the file its mtime changes and every node reloads on the next request.
//
// Writes go through a temp file + rename so a reader never observes a
// partially written JSON document (important once multiple nodes share EFS).
const _cache = {
  config: { mtimeMs: -1, value: null },
  endpoints: { mtimeMs: -1, value: null }
};

function _statMtime(file) {
  try { return fs.statSync(file).mtimeMs; } catch (e) { return -1; }
}

let _tmpCounter = 0;
function writeFileAtomic(file, data) {
  const tmp = `${file}.tmp.${process.pid}.${_tmpCounter++}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
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
  },
  {
    id: crypto.randomUUID(),
    path: '/blueprint',
    method: 'GET',
    description: 'Returns the API blueprint image',
    protected: false,
    token: null,
    parameterSource: 'none',
    parameters: [],
    responseType: 'binary',
    responses: [
      {
        condition: null,
        fileName: 'blueprint.png',
        contentType: 'image/png',
        assetPath: 'blueprint.png'
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
    return structuredClone(defaultConfig);
  }

  const mtime = _statMtime(CONFIG_FILE);
  let parsed;
  if (_cache.config.value && _cache.config.mtimeMs === mtime) {
    parsed = _cache.config.value;
  } else {
    try {
      parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      _cache.config = { mtimeMs: mtime, value: parsed };
    } catch (err) {
      console.error('Error loading config:', err);
      return structuredClone(defaultConfig);
    }
  }
  // structuredClone so callers can mutate the returned object without
  // corrupting the shared cache.
  return { ...defaultConfig, ...structuredClone(parsed) };
}

// Save configuration
function save(config) {
  ensureDirectories();
  writeFileAtomic(CONFIG_FILE, JSON.stringify(config, null, 2));
  _cache.config = { mtimeMs: _statMtime(CONFIG_FILE), value: structuredClone(config) };
}

// Load endpoints
function loadEndpoints() {
  ensureDirectories();

  if (!fs.existsSync(ENDPOINTS_FILE)) {
    saveEndpoints(defaultEndpoints);
    return structuredClone(defaultEndpoints);
  }

  const mtime = _statMtime(ENDPOINTS_FILE);
  if (_cache.endpoints.value && _cache.endpoints.mtimeMs === mtime) {
    return structuredClone(_cache.endpoints.value);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(ENDPOINTS_FILE, 'utf8'));
    _cache.endpoints = { mtimeMs: mtime, value: parsed };
    return structuredClone(parsed);
  } catch (err) {
    console.error('Error loading endpoints:', err);
    return structuredClone(defaultEndpoints);
  }
}

// Save endpoints
function saveEndpoints(endpoints) {
  ensureDirectories();
  writeFileAtomic(ENDPOINTS_FILE, JSON.stringify(endpoints, null, 2));
  _cache.endpoints = { mtimeMs: _statMtime(ENDPOINTS_FILE), value: structuredClone(endpoints) };
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

// Resolve a caller-supplied asset name to an absolute path INSIDE ASSETS_DIR.
// Returns null if the name would escape the assets directory (path traversal)
// or is otherwise invalid. Legitimate asset names are flat files that live
// directly in ASSETS_DIR (e.g. "<uuid>.png", "blueprint.png"), so this never
// affects normal operation — it only blocks "../" style escapes.
function resolveAssetPath(name) {
  if (typeof name !== 'string' || name === '') return null;
  const base = path.resolve(ASSETS_DIR);
  const resolved = path.resolve(base, name);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
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

// Save binary from base64 data URL
function saveAssetFromBase64(filename, base64Data) {
  ensureDirectories();
  const assetId = crypto.randomUUID();
  const ext = path.extname(filename) || '.bin';
  const assetPath = path.join(ASSETS_DIR, `${assetId}${ext}`);
  
  // Extract base64 data from data URL (format: data:image/png;base64,xxxxx)
  const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
  if (matches) {
    const buffer = Buffer.from(matches[2], 'base64');
    fs.writeFileSync(assetPath, buffer);
  } else {
    // Plain base64
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(assetPath, buffer);
  }
  
  return { id: assetId, filename, assetPath: `${assetId}${ext}` };
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

// ===== Blueprint image management =====

// Validate PNG by magic-byte signature
function isPng(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

// Seed the built-in default blueprint into the data volume if none exists yet
function ensureDefaultBlueprint() {
  ensureDirectories();
  if (!fs.existsSync(BLUEPRINT_FILE) && fs.existsSync(DEFAULT_BLUEPRINT_SEED)) {
    fs.copyFileSync(DEFAULT_BLUEPRINT_SEED, BLUEPRINT_FILE);
  }
}

// Save an uploaded PNG as blueprint.png (throws if not a valid PNG)
function saveBlueprint(buffer) {
  if (!isPng(buffer)) {
    throw new Error('File is not a valid PNG image');
  }
  ensureDirectories();
  fs.writeFileSync(BLUEPRINT_FILE, buffer);
  return true;
}

// Restore blueprint.png to the built-in default (or remove it if no default is bundled)
function resetBlueprint() {
  ensureDirectories();
  if (fs.existsSync(DEFAULT_BLUEPRINT_SEED)) {
    fs.copyFileSync(DEFAULT_BLUEPRINT_SEED, BLUEPRINT_FILE);
    return true;
  }
  if (fs.existsSync(BLUEPRINT_FILE)) fs.unlinkSync(BLUEPRINT_FILE);
  return true;
}

// Report current blueprint state (used by the admin UI)
function getBlueprintInfo() {
  const exists = fs.existsSync(BLUEPRINT_FILE);
  const hasDefault = fs.existsSync(DEFAULT_BLUEPRINT_SEED);
  let size = 0;
  let isDefault = false;
  if (exists) {
    size = fs.statSync(BLUEPRINT_FILE).size;
    if (hasDefault && size === fs.statSync(DEFAULT_BLUEPRINT_SEED).size) {
      try {
        isDefault = fs.readFileSync(BLUEPRINT_FILE).equals(fs.readFileSync(DEFAULT_BLUEPRINT_SEED));
      } catch (e) { /* ignore comparison errors */ }
    }
  }
  return { exists, size, isDefault, hasDefault };
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
    config: { ...config, adminPasswordHash: undefined, sessionSecret: undefined, setupToken: undefined },
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
      // Guard against path traversal (zip-slip): a malicious import must not be
      // able to write outside ASSETS_DIR (e.g. "../../src/server.js").
      const targetPath = resolveAssetPath(filename);
      if (!targetPath) {
        throw new Error(`Invalid asset filename in import: ${filename}`);
      }
      const buffer = Buffer.from(base64, 'base64');
      fs.writeFileSync(targetPath, buffer);
    });
  }
  
  return true;
}

// ===== Setup token (first-boot takeover protection, H1) =====
// Until an admin password is set, /setup is necessarily unauthenticated. To
// stop a random visitor from claiming the admin account first, /setup requires
// a one-time token. The token is either supplied out-of-band via the
// SETUP_TOKEN env var (best for multi-instance: same value on every node) or
// generated once and persisted here, to be read from the server logs.
// Returns the expected token while setup is pending, or null once setup is done
// (or if it is env-managed, in which case the env value is authoritative).
function ensureSetupToken() {
  if (process.env.SETUP_TOKEN) return process.env.SETUP_TOKEN;
  const config = load();
  if (config.adminPasswordHash) return null; // setup already complete
  if (!config.setupToken) {
    config.setupToken = crypto.randomBytes(24).toString('hex');
    save(config);
  }
  return config.setupToken;
}

// The token /setup must match: env value wins, else the persisted one.
function getExpectedSetupToken() {
  if (process.env.SETUP_TOKEN) return process.env.SETUP_TOKEN;
  const config = load();
  return config.setupToken || null;
}

// Remove the persisted token once setup completes (no-op when env-managed).
function clearSetupToken() {
  if (process.env.SETUP_TOKEN) return;
  const config = load();
  if (config.setupToken) {
    delete config.setupToken;
    save(config);
  }
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
  saveAssetFromBase64,
  getAsset,
  deleteAsset,
  resolveAssetPath,
  exportConfig,
  importConfig,
  updateScalability,
  getScalability,
  estimateResources,
  ensureSetupToken,
  getExpectedSetupToken,
  clearSetupToken,
  isPng,
  ensureDefaultBlueprint,
  saveBlueprint,
  resetBlueprint,
  getBlueprintInfo,
  DATA_DIR,
  ASSETS_DIR,
  BLUEPRINT_FILE
};

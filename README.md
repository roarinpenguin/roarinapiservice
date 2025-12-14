# 🐧 RoarinAPI Service

A dynamic, configurable API mock service with a web-based admin UI. Built with **Fastify** for maximum efficiency and minimal resource consumption.

## ✨ Features

- **Dynamic Endpoint Management** — Create, modify, and delete API endpoints via admin UI
- **Conditional Responses** — Return different data based on request parameters
- **Multiple Response Types** — JSON, text, binary files, images, redirects
- **Token Protection** — Configure per-endpoint bearer token authentication
- **Scalability Controls** — Configure workers and connections with resource estimates
- **Docker Ready** — Optimized multi-stage Docker build (~50MB image)
- **Export/Import** — Full configuration portability
- **Lightweight Admin UI** — Alpine.js with custom purple theme (~25KB)

## 🚀 Quick Start

### Docker (Recommended)

```bash
# Build and run
docker-compose up -d

# Access admin UI
open http://localhost:4242/admin
```

### Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Or production mode
npm start

# Access admin UI
open http://localhost:4242/admin
```

## 🔐 First Launch

On first launch, you'll be prompted to create an admin password. This password is stored securely (hashed) in the data volume and persists across restarts.

## 📁 Project Structure

```
roarinapiservice/
├── src/
│   ├── server.js              # Main Fastify server
│   ├── cluster.js             # Multi-worker support
│   ├── config/
│   │   └── configManager.js   # Configuration persistence
│   ├── plugins/
│   │   └── auth.js            # Authentication plugin
│   ├── routes/
│   │   ├── admin.js           # Admin API routes
│   │   └── dynamic.js         # Dynamic endpoint handler
│   └── public/
│       └── index.html         # Admin UI (Alpine.js)
├── data/                      # Persistent data (gitignored)
│   ├── config.json            # Server configuration
│   ├── endpoints.json         # Endpoint definitions
│   └── assets/                # Binary/image assets
├── nginx/
│   └── nginx.conf             # NGINX reverse proxy config
├── Dockerfile                 # Multi-stage Docker build
├── docker-compose.yml         # Docker Compose setup
└── package.json
```

## ⚙️ Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4242` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATA_DIR` | `./data` | Persistent data directory |
| `NODE_ENV` | `development` | Environment mode |

### Admin UI Features

- **Dashboard** — System stats, memory usage, uptime
- **Endpoints** — CRUD operations for API endpoints
- **Scalability** — Workers, connections, timeouts with resource estimates
- **Settings** — Password change, port configuration, server restart, export/import

### Scalability Settings

Configure via Admin UI → Scalability tab:

- **Workers**: Number of Node.js processes (1-16)
- **Max Connections**: Concurrent connection limit (100-10,000)
- **Connection Timeout**: Request timeout in ms
- **Keep-Alive Timeout**: Connection reuse timeout

## 🔌 API Endpoints

### Built-in Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check for load balancers |
| GET | `/admin` | Admin UI |
| ALL | `/api/admin*` | Admin API (authenticated) |

### Dynamic Endpoints

Create custom endpoints via the Admin UI with:

- **Method**: GET, POST, PUT, DELETE, PATCH, or ANY
- **Path**: Custom URL path (e.g., `/api/users`)
- **Protection**: Optional bearer token authentication
- **Parameter Source**: Query, headers, body, or mixed
- **Response Type**: JSON, text, binary, or redirect
- **Conditional Responses**: Return different data based on conditions

## 🐳 Docker Deployment

```bash
# Build image
docker build -t roarinapi .

# Run container
docker run -d \
  -p 4242:4242 \
  -v roarinapi-data:/app/data \
  --name roarinapi \
  roarinapi

# With docker-compose
docker-compose up -d
```

## 📊 Resource Estimates

The Admin UI provides resource impact estimates based on your scalability settings:

| Workers | Est. Memory | Est. CPU | Est. Throughput |
|---------|-------------|----------|-----------------|
| 1 | ~50 MB | 0.5 cores | ~1,000 req/s |
| 4 | ~150 MB | 2 cores | ~4,000 req/s |
| 8 | ~280 MB | 4 cores | ~8,000 req/s |

## 📤 Export/Import

Backup and restore your entire configuration:

1. Go to **Settings** → **Export/Import**
2. Click **Export Config** to download JSON backup
3. Use **Import Configuration** to restore

## 🛠️ Development

```bash
# Install dependencies
npm install

# Run in development mode (with auto-reload)
npm run dev

# Run tests
npm test

# Build Docker image
docker build -t roarinapi .
```

## 📝 License

MIT

---

Created with 💜 by the RoarinPenguin 🐧

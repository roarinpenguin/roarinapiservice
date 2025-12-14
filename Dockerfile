# RoarinAPI Service - Optimized Docker Image
# Multi-stage build for minimal footprint

# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (production only)
RUN npm ci --only=production && npm cache clean --force

# Production stage
FROM node:20-alpine

# Install dumb-init for proper signal handling and openssl for certificate generation
RUN apk add --no-cache dumb-init openssl

# Create non-root user
RUN addgroup -g 1001 -S roarinapi && \
    adduser -S roarinapi -u 1001 -G roarinapi

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY --chown=roarinapi:roarinapi src ./src
COPY --chown=roarinapi:roarinapi package.json ./

# Create data directory for persistent storage (including certs subdirectory)
RUN mkdir -p /app/data/certs && chown -R roarinapi:roarinapi /app/data

# Environment variables (PORT intentionally not set - read from config.json)
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

# Expose common ports
EXPOSE 443 4242

# Health check - try HTTPS first, fall back to HTTP, use configured port
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-check-certificate --no-verbose --tries=1 --spider https://localhost:${PORT:-4242}/health 2>/dev/null || wget --no-verbose --tries=1 --spider http://localhost:${PORT:-4242}/health || exit 1

# Switch to non-root user
USER roarinapi

# Use dumb-init as PID 1
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "src/server.js"]

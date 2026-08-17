FROM node:22-slim

WORKDIR /app

# Copy package files
COPY sdk/typescript/package.json sdk/typescript/package-lock.json* ./

# Install dependencies
RUN npm ci --production || npm install --production

# Copy source
COPY sdk/typescript/ ./

# Build
RUN npm run build

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/.well-known/aep').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start
CMD ["node", "dist/cli.js", "serve", "--port", "8080"]


FROM node:18.13.0

WORKDIR /usr/src/goof

# Copying dependency files first for better Docker layer caching
COPY package*.json ./

# Installing exactly what is recorded in package-lock.json
RUN npm ci

# Copying application source and assign ownership to the non-root user
COPY --chown=node:node . .

# Keeping the temporary directory used by the application
RUN mkdir -p /tmp/extracted_files && \
    chown -R node:node /tmp/extracted_files /usr/src/goof

# IMPORTANT: must not run the application as root
USER node

EXPOSE 3001 9229

HEALTHCHECK --interval=30s \
            --timeout=5s \
            --start-period=20s \
            --retries=3 \
            CMD node -e "require('http').get('http://127.0.0.1:3001',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["npm", "start"]
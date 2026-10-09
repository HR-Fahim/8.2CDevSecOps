FROM node:20

WORKDIR /usr/src/goof

# Copy dependency manifests explicitly so Docker can cache npm ci.
COPY --chown=node:node package.json package-lock.json ./
# Prevent dependency lifecycle scripts from running during installation.
RUN npm ci --ignore-scripts

# Copy application files explicitly instead of copying the entire build context.
# This keeps repository metadata, local reports and unrelated files out of the image.
COPY --chown=node:node app.js app.json example111.json mongoose-db.js typeorm-db.js utils.js ./
COPY --chown=node:node entity/ ./entity/
COPY --chown=node:node exploits/ ./exploits/
COPY --chown=node:node public/ ./public/
COPY --chown=node:node routes/ ./routes/
COPY --chown=node:node service/ ./service/
COPY --chown=node:node tests/ ./tests/
COPY --chown=node:node views/ ./views/

# Create the temporary workspace without recursively changing ownership.
RUN mkdir -p /tmp/extracted_files && \
    chown node:node /tmp/extracted_files /usr/src/goof

USER node

EXPOSE 3001 9229

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/',r=>process.exit(r.statusCode>=200&&r.statusCode<400?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["npm", "start"]

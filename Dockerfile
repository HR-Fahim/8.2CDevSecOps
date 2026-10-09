FROM node:20

WORKDIR /usr/src/goof

# Copy dependency manifests first so Docker can cache npm ci.
COPY package*.json ./
RUN npm ci

# .dockerignore keeps local dependencies, Git history and reports out of the image.
COPY --chown=node:node . .

# Create the temporary workspace without recursively changing ownership.
RUN mkdir -p /tmp/extracted_files && \
    chown node:node /tmp/extracted_files /usr/src/goof

USER node

EXPOSE 3001 9229

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/',r=>process.exit(r.statusCode>=200&&r.statusCode<400?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["npm", "start"]

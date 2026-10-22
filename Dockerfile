FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --chown=node:node . .
RUN mkdir -p /var/data/uploads && chown -R node:node /var/data /app

ENV DATA_FILE=/var/data/data.json
ENV UPLOAD_DIR=/var/data/uploads
EXPOSE 3000

USER node
CMD ["npm", "start"]

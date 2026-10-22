FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --chown=node:node . .
RUN mkdir -p /tmp/app-downloader/uploads && chown -R node:node /app /tmp/app-downloader

ENV DATA_FILE=/tmp/app-downloader/data.json
ENV UPLOAD_DIR=/tmp/app-downloader/uploads

EXPOSE 3000
USER node
CMD ["npm", "start"]

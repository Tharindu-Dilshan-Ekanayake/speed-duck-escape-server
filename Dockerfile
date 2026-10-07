FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
# Legion requirement: run as non-root (the node image ships a "node" user).
USER node
ENV PORT=2567
EXPOSE 2567
CMD ["node", "src/index.js"]

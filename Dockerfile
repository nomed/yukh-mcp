FROM node:24.6.0-bookworm-slim AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY apps ./apps
COPY contracts ./contracts
COPY packages ./packages
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:24.6.0-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /workspace/package.json /workspace/package-lock.json ./
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/apps/gateway/src/main.js"]

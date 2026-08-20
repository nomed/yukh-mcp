FROM node:26.7.0-bookworm-slim AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY apps ./apps
COPY contracts ./contracts
COPY packages ./packages
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:26.7.0-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /workspace/package.json /workspace/package-lock.json ./
COPY --from=build --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/dist ./dist
COPY --chown=node:node --chmod=0755 .github/scripts/check-compose-runtime.mjs ./.github/scripts/check-compose-runtime.mjs
COPY --chown=node:node .yukh/project.yaml ./.yukh/project.yaml
USER node
EXPOSE 3000
CMD ["node", "dist/apps/gateway/src/main.js"]

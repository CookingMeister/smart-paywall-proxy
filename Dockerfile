# Dependencies are installed in a throwaway stage so the runtime image carries
# no npm, yarn or corepack: the app never uses them, and they account for most
# of the CVEs reported against the stock node image.
FROM node:26-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:26-alpine

# tini replaces compose's `init: true`: node as PID 1 ignores SIGTERM, so pod
# shutdowns would otherwise wait out the full grace period and then be killed.
RUN apk add --no-cache tini \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000

# The node image's user is uid/gid 1000, which lets Kubernetes enforce
# runAsNonRoot with a numeric id.
USER node

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]

FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY scripts ./scripts
COPY apps ./apps
COPY packages ./packages
RUN corepack enable && pnpm install --filter @yksprite/service... --frozen-lockfile
RUN pnpm --filter @yksprite/service... build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=base /app ./
RUN mkdir -p /app/data
EXPOSE 3000
CMD ["node", "apps/service/dist/index.js"]

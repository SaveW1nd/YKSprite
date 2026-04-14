FROM node:22-alpine AS base
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN corepack enable && pnpm install
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=base /app ./
EXPOSE 3000
CMD ["pnpm", "--filter", "@yksprite/service", "start"]

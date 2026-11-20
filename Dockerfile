# ---- Build stage -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# `prisma generate` (postinstall) reads prisma.config.ts, which requires a URL;
# a placeholder is enough because generation never connects to the database.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build

COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage -----------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist ./dist

USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]

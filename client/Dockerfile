# ---------- Stage 1: build the Angular app ----------
FROM node:22-alpine AS build
WORKDIR /src

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build -- --configuration=production

# ---------- Stage 2: serve with Nginx ----------
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist/client/browser /usr/share/nginx/html

EXPOSE 80
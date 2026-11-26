FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --registry=https://registry.npmjs.org \
 && sha256sum package-lock.json | cut -d ' ' -f 1 > node_modules/.modern-tech-lock
FROM dependencies AS development
COPY start-development.sh /usr/local/bin/start-development
COPY . .
EXPOSE 5173
CMD ["sh", "/usr/local/bin/start-development"]
FROM dependencies AS build
COPY . .
RUN npm run build
FROM nginx:1.28-alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

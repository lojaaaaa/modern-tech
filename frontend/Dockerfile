FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --registry=https://registry.npmjs.org
FROM dependencies AS development
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]
FROM dependencies AS build
COPY . .
RUN npm run build
FROM nginx:1.28-alpine AS production
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

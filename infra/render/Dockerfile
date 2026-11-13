FROM node:24-alpine AS frontend
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci --registry=https://registry.npmjs.org
COPY frontend/ ./
RUN npm run build

FROM php:8.4-apache-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev libzip-dev libicu-dev unzip git redis-server supervisor \
 && docker-php-ext-install pdo_pgsql intl zip pcntl bcmath \
 && a2enmod rewrite headers \
 && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
COPY infra/php/uploads.ini /usr/local/etc/php/conf.d/uploads.ini
WORKDIR /var/www/html
COPY backend/ ./
RUN composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction \
 && chown -R www-data:www-data storage bootstrap/cache
COPY --from=frontend /app/dist/ public/
COPY infra/render/site.conf /etc/apache2/sites-available/000-default.conf
COPY infra/render/processes.conf /etc/supervisor/conf.d/modern-tech.conf
COPY infra/render/provision.php /var/www/html/render-provision.php
COPY infra/render/start.sh /usr/local/bin/start-modern-tech
ENV APP_ENV=production APP_DEBUG=false LOG_CHANNEL=stderr DB_CONNECTION=pgsql REDIS_CLIENT=predis REDIS_CACHE_HOST=127.0.0.1 CACHE_STORE=redis QUEUE_CONNECTION=redis REDIS_QUEUE_RETRY_AFTER=960 SESSION_SECURE_COOKIE=true
CMD ["sh", "/usr/local/bin/start-modern-tech"]

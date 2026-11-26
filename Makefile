.PHONY: bootstrap dependencies up down migrate smoke test coverage coverage-web coverage-api lint web-check backup staging staging-down

LOCAL_COMPOSE := docker compose
ifneq ($(wildcard .local/office.env),)
LOCAL_COMPOSE += -f compose.yaml -f compose.office.yaml --env-file .env --env-file .local/office.env
LOCAL_OFFICE_SERVICE := office-documentserver
endif

bootstrap:
	./scripts/bootstrap.sh
dependencies: bootstrap
	docker run --rm -v "$(CURDIR)/backend:/app" -w /app composer:2 composer install --no-interaction --prefer-dist
up: dependencies
	$(LOCAL_COMPOSE) up -d --build --wait --wait-timeout 180 postgres redis-queue redis-cache tika gotenberg clamav mailpit api web
	$(LOCAL_COMPOSE) exec -T api php artisan migrate --force
	$(LOCAL_COMPOSE) up -d --build --wait --wait-timeout 240 gateway worker worker-processing worker-transfers scheduler $(LOCAL_OFFICE_SERVICE)
migrate:
	docker compose exec api php artisan migrate --force
down:
	$(LOCAL_COMPOSE) down
smoke:
	docker compose exec -T api php tests/Smoke/pipeline.php
	docker compose exec -T api php tests/Smoke/session.php
	docker compose exec -T api php tests/Smoke/preview.php
test:
	$(LOCAL_COMPOSE) exec -T api php artisan test
	cd frontend && npm test
coverage: coverage-web coverage-api
coverage-web:
	cd frontend && npm run test:coverage
coverage-api:
	cd backend && XDEBUG_MODE=coverage php vendor/bin/phpunit --coverage-text --coverage-html coverage --coverage-clover coverage/clover.xml
lint:
	docker compose exec api vendor/bin/pint --test
	docker compose exec api vendor/bin/phpstan analyse --memory-limit=512M
	cd frontend && npm run lint
web-check:
	cd frontend && npm run typecheck && npm run build
backup:
	./scripts/backup.sh

staging:
	bash scripts/staging-up.sh
staging-down:
	docker compose --env-file .local/staging/compose.env -f compose.staging.yaml down

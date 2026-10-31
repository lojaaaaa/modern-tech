.PHONY: bootstrap dependencies up down migrate smoke test lint web-check backup staging staging-down
bootstrap:
	./scripts/bootstrap.sh
dependencies: bootstrap
	docker run --rm -v "$(CURDIR)/backend:/app" -w /app composer:2 composer install --no-interaction --prefer-dist
up: dependencies
	docker compose up -d --build --wait --wait-timeout 180 postgres redis-queue redis-cache tika gotenberg clamav mailpit api web gateway
	docker compose exec -T api php artisan migrate --force
	docker compose up -d --build --wait --wait-timeout 180 worker worker-processing worker-transfers scheduler
migrate:
	docker compose exec api php artisan migrate --force
down:
	docker compose down
smoke:
	docker compose exec -T api php tests/Smoke/pipeline.php
	docker compose exec -T api php tests/Smoke/session.php
	docker compose exec -T api php tests/Smoke/preview.php
test:
	docker compose exec api php artisan test
	cd frontend && npm test
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

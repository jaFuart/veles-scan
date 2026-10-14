ROOT_DIR:=$(abspath $(CURDIR)/..)
COMPOSE=docker compose --env-file $(ROOT_DIR)/.env -f $(ROOT_DIR)/docker-compose.unified.yml

.PHONY: db-up db-down db-reset db-seed db-logs

db-up:
	$(COMPOSE) up -d postgres

db-down:
	$(COMPOSE) stop postgres

db-reset:
	$(COMPOSE) down -v
	$(COMPOSE) up -d postgres

db-seed:
	./scripts/load-test-data.sh

db-logs:
	$(COMPOSE) logs -f postgres

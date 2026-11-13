-include local.mk
NAME := ig-gateway
DEST ?= /opt/$(NAME)
# Unidad de sistema de ejemplo: deploy/$(NAME).service.example. La unidad real
# la instala quien administra el servidor (por ejemplo en
# /etc/systemd/system/$(NAME).service).

.PHONY: install build test coverage typecheck deploy restart

install:
	pnpm install --frozen-lockfile

build:
	pnpm build

test:
	pnpm test

coverage:
	pnpm test:coverage

typecheck:
	pnpm typecheck

deploy:
	pnpm build && \
	  install -d $(DEST)/logs && \
	  rsync -a --delete dist/ $(DEST)/dist/ && \
	  cp package.json pnpm-lock.yaml $(DEST)/
	cd $(DEST) && CI=true pnpm install --prod --no-frozen-lockfile
	sudo systemctl restart $(NAME).service

restart:
	sudo systemctl restart $(NAME).service

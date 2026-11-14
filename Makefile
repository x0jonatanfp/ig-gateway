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

deploy: release
	pnpm build && \
	  install -d $(DEST)/logs && \
	  rsync -a --delete dist/ $(DEST)/dist/ && \
	  cp package.json pnpm-lock.yaml $(DEST)/
	cd $(DEST) && CI=true pnpm install --prod --no-frozen-lockfile
	sudo systemctl restart $(NAME).service

restart:
	sudo systemctl restart $(NAME).service

# Versión: la calcula commit-and-tag-version a partir de los commits desde la
# última etiqueta (`!` major, feat minor, fix patch, el resto nada). Escribe
# la versión y el CHANGELOG.md, commitea `chore(release)` y etiqueta; si no
# hay feat, fix ni `!` nuevos, no hace nada. Corre antes de desplegar.
CATV := npx -y commit-and-tag-version@13.3.0

.PHONY: check-clean release

check-clean:
	@test -z "$$(git status --porcelain)" || { echo "ERROR: hay cambios sin commitear; commitea antes de desplegar"; exit 1; }

release: check-clean
	$(CATV)
	git push --follow-tags

.PHONY: help build up down logs test open check-public
help:  ## questo elenco
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-8s %s\n", $$1, $$2}'
build: ## costruisce l'immagine
	docker compose build
up:    ## accende la pagina su http://127.0.0.1:8073
	mkdir -p recordings && docker compose up -d --build && echo "→ http://127.0.0.1:8073"
down:  ## spegne (libera l'HackRF)
	docker compose down
logs:  ## log del container
	docker compose logs -f
test:  ## test con l'HackRF finto (nel container)
	docker build -q --target test -t hackrf-web:test . >/dev/null && docker run --rm hackrf-web:test
open:  ## apre la pagina
	xdg-open http://127.0.0.1:8073
check-public: ## cerca nel repo e nella storia dati privati (e-mail, host, token)
	@./scripts/check-public.sh

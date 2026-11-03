.PHONY: db dev-server dev-admin dev-agent dev-desktop build test docker
db:            ## start local Postgres
	docker compose up -d db
dev-server:    ## API + admin console + landing on :8080 (dev mode prints emails/codes)
	cd backend && DEV_MODE=true go run ./cmd/server
dev-admin:     ## admin console with hot reload on :5173 (proxies /api to :8080)
	cd ui && npm install && npm run dev:admin
dev-agent:     ## background agent pointed at the local server
	cd agent && go run ./cmd/aknologia-agent -server http://localhost:8080
dev-desktop:   ## desktop window with hot reload (needs the Wails CLI)
	cd desktop && wails dev
build:         ## production builds of everything that doesn't need Wails
	cd ui && npm ci && npm run build
	cd backend && go build -o ../dist/server ./cmd/server
	cd agent && go build -o ../dist/aknologia-agent ./cmd/aknologia-agent
test:
	cd backend && go vet ./...
	cd agent && go test ./...
	cd ui && npm run typecheck
docker:
	docker compose up --build

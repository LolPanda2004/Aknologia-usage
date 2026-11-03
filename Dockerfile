# Aknologia Usage server: API + admin console (/app/) + landing page (/).
# Build from the repository root:  docker build -t aknologia-usage .

FROM node:22-alpine AS ui
WORKDIR /src/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY ui/ ./
RUN npm run build:admin

FROM golang:1.26-alpine AS api
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/server ./cmd/server

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
WORKDIR /app
COPY --from=api /out/server /app/server
COPY --from=ui /src/ui/dist/admin /app/web
COPY landing/ /app/landing
ENV PORT=8080 WEB_DIR=/app/web LANDING_DIR=/app/landing
USER app
EXPOSE 8080
CMD ["/app/server"]

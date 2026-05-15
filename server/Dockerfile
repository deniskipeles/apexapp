FROM golang:1.21-alpine AS builder

WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY main.go ./
RUN go build -o apex-tunnel-server main.go

FROM alpine:latest
RUN apk add --no-cache ca-certificates libc6-compat
WORKDIR /app

# Copy the built Go binary
COPY --from=builder /app/apex-tunnel-server .

# Expose HTTP, HTTPS, and FRPC connection ports
EXPOSE 80 443 7000

# Run it
CMD ["./apex-tunnel-server"]
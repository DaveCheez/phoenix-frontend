# Phoenix Vanz frontend

Nuxt frontend for Phoenix Vanz, backed by the Django API.

## Development

```bash
cp .env.example .env
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run start
```

## Docker

```bash
docker build -t phoenix-vanz-frontend .
docker run --rm -p 8080:8080 \
  -e NUXT_DJANGO_API_BASE=http://host.docker.internal:8000/api \
  phoenix-vanz-frontend
```

See `DEPLOYMENT.md` for DigitalOcean instructions.

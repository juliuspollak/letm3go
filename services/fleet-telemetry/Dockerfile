FROM node:24-bookworm-slim
WORKDIR /app
COPY services/fleet-telemetry/package*.json ./services/fleet-telemetry/
RUN cd services/fleet-telemetry && npm ci --omit=dev --ignore-scripts
COPY services/fleet-telemetry ./services/fleet-telemetry
COPY supabase/functions/_shared/fleetTelemetry.js ./supabase/functions/_shared/fleetTelemetry.js
USER node
WORKDIR /app/services/fleet-telemetry
CMD ["node","consumer.mjs"]

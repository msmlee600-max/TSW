# HaulSafe — HGV/LGV Truck Navigation Safety App

## Problem
Truck drivers (HGV/LGV/vans) need a navigation app that warns them about route restrictions specific to their vehicle (bridge heights, weight limits, width limits) and gives them live wind/weather conditions ahead of them on the journey.

## Solution
A dark-themed mobile app (React Native + Expo Router) with:
- **Truck profile setup**: vehicle type, height, width, length, weight, axles, hazmat, avoid tolls/motorways
- **Map screen** (Leaflet via WebView with CartoDB Dark Matter tiles)
- **Destination search** via Nominatim
- **Route planning** via OSRM, displayed as polyline
- **Route safety analysis** via Overpass API (OSM tags: maxheight, maxweight, maxwidth, maxlength, hazmat, bridge=yes) — flagged as critical when limits exceed the truck's profile values
- **Live weather along route** via Open-Meteo at sampled waypoints (wind, gusts, precipitation, visibility, temperature) with severity coding
- **Bottom sheet** with ETA, distance, alerts count, warnings list, weather strip, turn-by-turn directions
- **Wind alert banner** at the top when high wind is detected ahead

## Tech
- Frontend: Expo SDK 54, Expo Router, react-native-webview, Leaflet, expo-linear-gradient, AsyncStorage
- Backend: FastAPI + Motor (MongoDB), httpx
- APIs (no keys): Nominatim, OSRM, Overpass, Open-Meteo

## Subscription & Auto-Reroute (added in iteration 2)
- 7-day free trial auto-starts on first launch
- Yearly £120 subscription via Stripe Checkout (test key from environment)
- Trial banner / expired banner shown over map; tap opens paywall modal
- After payment, polling detects success, subscription marked active for 365 days
- Paywall blocks route planning when subscription expired
- Auto-reroute: when route has critical warnings, system requests OSRM alternatives, analyses each, and shows red "DANGER ahead — switch route?" banner with a one-tap "USE SAFER" button to switch to a route with fewer critical hazards.

## Endpoints
- `GET /api/subscription/{device_id}` — get/auto-create with 7-day trial
- `POST /api/payments/checkout/session` — create Stripe Checkout session
- `GET /api/payments/checkout/status/{session_id}` — poll payment, activate subscription
- `POST /api/webhook/stripe` — Stripe webhook for async confirmation

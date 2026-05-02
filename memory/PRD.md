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

## Endpoints
- `GET /api/truck-profile/{device_id}` — get/auto-create profile
- `PUT /api/truck-profile` — upsert profile by device_id
- `GET /api/geocode?q=` — Nominatim search
- `POST /api/route` — OSRM route between two LatLng
- `POST /api/route-analysis` — analyse warnings + weather along a route

from fastapi import FastAPI, APIRouter, HTTPException, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import math
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Tuple
import uuid
from datetime import datetime, timezone
import httpx
import asyncio
from fastapi import Request
from emergentintegrations.payments.stripe.checkout import (
    StripeCheckout,
    CheckoutSessionResponse,
    CheckoutStatusResponse,
    CheckoutSessionRequest,
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="HGV Safe Route API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ---------- Models ----------
class TruckProfile(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    device_id: str
    name: str = "My Truck"
    vehicle_type: str = "HGV"  # HGV, LGV, Truck, Van
    height_m: float = 4.5
    width_m: float = 2.55
    length_m: float = 16.5
    weight_t: float = 44.0
    axles: int = 5
    hazmat: bool = False
    avoid_tolls: bool = False
    avoid_motorways: bool = False
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class TruckProfileUpdate(BaseModel):
    device_id: str
    name: Optional[str] = None
    vehicle_type: Optional[str] = None
    height_m: Optional[float] = None
    width_m: Optional[float] = None
    length_m: Optional[float] = None
    weight_t: Optional[float] = None
    axles: Optional[int] = None
    hazmat: Optional[bool] = None
    avoid_tolls: Optional[bool] = None
    avoid_motorways: Optional[bool] = None

class LatLng(BaseModel):
    lat: float
    lng: float

class RouteRequest(BaseModel):
    origin: LatLng
    destination: LatLng
    alternatives: bool = False

class RouteAnalysisRequest(BaseModel):
    coordinates: List[List[float]]  # [[lat, lng], ...]
    profile: Optional[TruckProfile] = None

# Subscription
SUBSCRIPTION_PLANS = {
    "yearly_haulsafe": {"amount": 120.00, "currency": "gbp", "label": "HaulSafe Yearly", "days": 365},
}
TRIAL_DAYS = 7

class CheckoutCreateRequest(BaseModel):
    device_id: str
    plan_id: str = "yearly_haulsafe"
    origin_url: str

# ---------- Helpers ----------
def haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    R = 6371.0
    lat1, lon1, lat2, lon2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 2 * R * math.asin(math.sqrt(h))

def sample_waypoints(coords: List[List[float]], num: int = 6) -> List[List[float]]:
    if len(coords) <= num:
        return coords
    step = len(coords) // num
    pts = [coords[i*step] for i in range(num)]
    pts.append(coords[-1])
    return pts

def bbox_from_coords(coords: List[List[float]], pad: float = 0.01):
    lats = [c[0] for c in coords]
    lngs = [c[1] for c in coords]
    return (min(lats)-pad, min(lngs)-pad, max(lats)+pad, max(lngs)+pad)

# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"message": "HGV Safe Route API running"}

# Truck profile
@api_router.get("/truck-profile/{device_id}", response_model=TruckProfile)
async def get_profile(device_id: str):
    doc = await db.truck_profiles.find_one({"device_id": device_id}, {"_id": 0})
    if not doc:
        # return default new profile
        prof = TruckProfile(device_id=device_id)
        await db.truck_profiles.insert_one(prof.model_dump())
        doc = await db.truck_profiles.find_one({"device_id": device_id}, {"_id": 0})
    return TruckProfile(**doc)

@api_router.put("/truck-profile", response_model=TruckProfile)
async def upsert_profile(payload: TruckProfileUpdate):
    update = {k: v for k, v in payload.model_dump().items() if v is not None and k != "device_id"}
    update["updated_at"] = datetime.now(timezone.utc)
    await db.truck_profiles.update_one(
        {"device_id": payload.device_id},
        {"$set": update, "$setOnInsert": {"id": str(uuid.uuid4()), "device_id": payload.device_id}},
        upsert=True,
    )
    doc = await db.truck_profiles.find_one({"device_id": payload.device_id}, {"_id": 0})
    return TruckProfile(**doc)

# Geocode (Nominatim)
@api_router.get("/geocode")
async def geocode(q: str = Query(..., min_length=2)):
    url = "https://nominatim.openstreetmap.org/search"
    params = {"q": q, "format": "json", "addressdetails": 1, "limit": 6}
    headers = {"User-Agent": "HGV-Safe-Route-App/1.0"}
    try:
        async with httpx.AsyncClient(timeout=12.0) as cli:
            r = await cli.get(url, params=params, headers=headers)
            r.raise_for_status()
            data = r.json()
        results = [
            {
                "display_name": d.get("display_name"),
                "lat": float(d["lat"]),
                "lng": float(d["lon"]),
                "type": d.get("type"),
            }
            for d in data
        ]
        return {"results": results}
    except Exception as e:
        logger.error(f"geocode error: {e}")
        raise HTTPException(status_code=502, detail="Geocoding service unavailable")

# Routing (OSRM public)
@api_router.post("/route")
async def route(req: RouteRequest):
    coords = f"{req.origin.lng},{req.origin.lat};{req.destination.lng},{req.destination.lat}"
    url = f"https://router.project-osrm.org/route/v1/driving/{coords}"
    params = {"overview": "full", "geometries": "geojson", "steps": "true", "annotations": "false"}
    if req.alternatives:
        params["alternatives"] = "true"
    try:
        async with httpx.AsyncClient(timeout=20.0) as cli:
            r = await cli.get(url, params=params)
            r.raise_for_status()
            data = r.json()
        if not data.get("routes"):
            raise HTTPException(status_code=404, detail="No route found")

        def parse_route(rt):
            geometry = [[c[1], c[0]] for c in rt["geometry"]["coordinates"]]
            steps = []
            for leg in rt.get("legs", []):
                for s in leg.get("steps", []):
                    m = s.get("maneuver", {})
                    steps.append({
                        "instruction": f"{m.get('type', 'continue').replace('_', ' ').title()} on {s.get('name') or 'road'}",
                        "type": m.get("type", "continue"),
                        "modifier": m.get("modifier"),
                        "distance_m": s.get("distance", 0),
                        "duration_s": s.get("duration", 0),
                        "name": s.get("name", ""),
                    })
            return {
                "geometry": geometry,
                "distance_m": rt.get("distance", 0),
                "duration_s": rt.get("duration", 0),
                "steps": steps,
            }

        primary = parse_route(data["routes"][0])
        alternatives = [parse_route(rt) for rt in data["routes"][1:]] if req.alternatives else []
        return {**primary, "alternatives": alternatives}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"route error: {e}")
        raise HTTPException(status_code=502, detail="Routing service unavailable")

# Route safety + weather analysis
@api_router.post("/route-analysis")
async def route_analysis(req: RouteAnalysisRequest):
    if len(req.coordinates) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 coordinates")

    waypoints = sample_waypoints(req.coordinates, num=6)
    minlat, minlng, maxlat, maxlng = bbox_from_coords(req.coordinates, pad=0.005)

    # --- Overpass query for bridges, height/weight/width/length restrictions ---
    overpass_query = f"""
    [out:json][timeout:25];
    (
      way["maxheight"]({minlat},{minlng},{maxlat},{maxlng});
      way["maxweight"]({minlat},{minlng},{maxlat},{maxlng});
      way["maxwidth"]({minlat},{minlng},{maxlat},{maxlng});
      way["maxlength"]({minlat},{minlng},{maxlat},{maxlng});
      way["bridge"="yes"]["maxheight"]({minlat},{minlng},{maxlat},{maxlng});
      way["hazmat"]({minlat},{minlng},{maxlat},{maxlng});
    );
    out tags center 200;
    """

    async def fetch_overpass():
        endpoints = [
            "https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.openstreetmap.fr/api/interpreter",
        ]
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "HGV-Safe-Route-App/1.0",
        }
        for url in endpoints:
            try:
                async with httpx.AsyncClient(timeout=25.0) as cli:
                    r = await cli.post(url, content=f"data={overpass_query}", headers=headers)
                    r.raise_for_status()
                    return r.json()
            except Exception as e:
                logger.warning(f"overpass {url} failed: {e}")
        return {"elements": []}

    async def fetch_weather(lat: float, lng: float):
        url = "https://api.open-meteo.com/v1/forecast"
        params = {
            "latitude": lat,
            "longitude": lng,
            "current": "temperature_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation,weather_code,visibility",
            "wind_speed_unit": "kmh",
            "timezone": "auto",
        }
        try:
            async with httpx.AsyncClient(timeout=12.0) as cli:
                r = await cli.get(url, params=params)
                r.raise_for_status()
                return r.json()
        except Exception as e:
            logger.warning(f"weather failed: {e}")
            return None

    overpass_task = asyncio.create_task(fetch_overpass())
    weather_tasks = [asyncio.create_task(fetch_weather(wp[0], wp[1])) for wp in waypoints]
    overpass_data = await overpass_task
    weather_data = await asyncio.gather(*weather_tasks)

    # Parse warnings from overpass and check against truck profile
    profile = req.profile
    warnings = []

    def parse_num(v):
        try:
            return float(str(v).split()[0].replace(",", "."))
        except Exception:
            return None

    for el in overpass_data.get("elements", []):
        tags = el.get("tags", {})
        center = el.get("center", {})
        lat = center.get("lat")
        lon = center.get("lon")
        if lat is None or lon is None:
            continue
        # find min distance from route
        min_d = min((haversine_km((lat, lon), (c[0], c[1])) for c in req.coordinates), default=999)
        if min_d > 1.5:  # > 1.5km off route, skip
            continue

        name = tags.get("name") or tags.get("ref") or "Road"
        for key, label, unit, profile_field in [
            ("maxheight", "Height limit", "m", "height_m"),
            ("maxweight", "Weight limit", "t", "weight_t"),
            ("maxwidth", "Width limit", "m", "width_m"),
            ("maxlength", "Length limit", "m", "length_m"),
        ]:
            if key in tags:
                val = parse_num(tags[key])
                if val is None:
                    continue
                exceeds = False
                if profile is not None:
                    pv = getattr(profile, profile_field, None)
                    if pv is not None and pv > val:
                        exceeds = True
                warnings.append({
                    "type": key,
                    "label": label,
                    "value": val,
                    "unit": unit,
                    "name": name,
                    "lat": lat,
                    "lng": lon,
                    "distance_km": round(min_d, 2),
                    "critical": exceeds,
                    "bridge": tags.get("bridge") == "yes",
                })
        if tags.get("hazmat") == "no" and profile and profile.hazmat:
            warnings.append({
                "type": "hazmat",
                "label": "Hazmat prohibited",
                "value": None,
                "unit": "",
                "name": name,
                "lat": lat,
                "lng": lon,
                "distance_km": round(min_d, 2),
                "critical": True,
                "bridge": False,
            })

    # Sort by distance along route start (rough)
    warnings.sort(key=lambda x: x["distance_km"])

    # Build weather strip
    weather_points = []
    for i, (wp, wd) in enumerate(zip(waypoints, weather_data)):
        if not wd or "current" not in wd:
            continue
        cur = wd["current"]
        wind = cur.get("wind_speed_10m", 0)
        gust = cur.get("wind_gusts_10m", 0)
        precip = cur.get("precipitation", 0)
        vis = cur.get("visibility", None)
        wcode = cur.get("weather_code", 0)
        # severity
        severity = "ok"
        if wind >= 80 or gust >= 100 or (vis is not None and vis < 1000):
            severity = "danger"
        elif wind >= 50 or gust >= 70 or precip >= 5 or (vis is not None and vis < 5000):
            severity = "warning"
        weather_points.append({
            "lat": wp[0],
            "lng": wp[1],
            "temperature_c": cur.get("temperature_2m"),
            "wind_kmh": wind,
            "gust_kmh": gust,
            "wind_direction": cur.get("wind_direction_10m"),
            "precipitation_mm": precip,
            "visibility_m": vis,
            "weather_code": wcode,
            "severity": severity,
            "index": i,
        })

    # Summary
    critical_count = sum(1 for w in warnings if w.get("critical"))
    high_wind = any(p["severity"] == "danger" for p in weather_points)
    summary = {
        "total_warnings": len(warnings),
        "critical_warnings": critical_count,
        "high_wind_alert": high_wind,
        "max_wind_kmh": max((p["gust_kmh"] for p in weather_points), default=0),
    }

    return {
        "warnings": warnings,
        "weather": weather_points,
        "summary": summary,
    }


app.include_router(api_router)

@api_router.get("/subscription/{device_id}")
async def get_subscription(device_id: str):
    sub = await db.subscriptions.find_one({"device_id": device_id}, {"_id": 0})
    now = datetime.now(timezone.utc)
    if not sub:
        # Auto-start trial
        trial_end = now + __import__("datetime").timedelta(days=TRIAL_DAYS)
        sub = {"device_id": device_id, "status": "trial", "trial_ends_at": trial_end, "expires_at": trial_end, "created_at": now}
        await db.subscriptions.insert_one(sub.copy())
        sub.pop("_id", None)
    expires_at = sub.get("expires_at")
    active = expires_at is not None and (expires_at if isinstance(expires_at, datetime) else datetime.fromisoformat(str(expires_at).replace("Z",""))) > now
    return {
        "device_id": device_id,
        "status": sub.get("status", "expired") if active else "expired",
        "active": active,
        "expires_at": expires_at.isoformat() if isinstance(expires_at, datetime) else expires_at,
        "is_trial": sub.get("status") == "trial" and active,
    }

@api_router.post("/payments/checkout/session")
async def create_checkout(req: CheckoutCreateRequest, http_request: Request):
    if req.plan_id not in SUBSCRIPTION_PLANS:
        raise HTTPException(status_code=400, detail="Invalid plan")
    plan = SUBSCRIPTION_PLANS[req.plan_id]
    api_key = os.environ.get("STRIPE_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    host = str(http_request.base_url).rstrip("/")
    stripe = StripeCheckout(api_key=api_key, webhook_url=f"{host}/api/webhook/stripe")
    success_url = f"{req.origin_url}/map?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{req.origin_url}/map?cancelled=1"
    metadata = {"device_id": req.device_id, "plan_id": req.plan_id, "source": "haulsafe_app"}
    creq = CheckoutSessionRequest(
        amount=plan["amount"], currency=plan["currency"],
        success_url=success_url, cancel_url=cancel_url, metadata=metadata,
    )
    session: CheckoutSessionResponse = await stripe.create_checkout_session(creq)
    await db.payment_transactions.insert_one({
        "session_id": session.session_id, "device_id": req.device_id, "plan_id": req.plan_id,
        "amount": plan["amount"], "currency": plan["currency"], "payment_status": "initiated",
        "status": "pending", "metadata": metadata, "created_at": datetime.now(timezone.utc),
    })
    return {"url": session.url, "session_id": session.session_id}

@api_router.get("/payments/checkout/status/{session_id}")
async def checkout_status(session_id: str, http_request: Request):
    api_key = os.environ.get("STRIPE_API_KEY")
    host = str(http_request.base_url).rstrip("/")
    stripe = StripeCheckout(api_key=api_key, webhook_url=f"{host}/api/webhook/stripe")
    status: CheckoutStatusResponse = await stripe.get_checkout_status(session_id)
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if tx and tx.get("payment_status") != "paid" and status.payment_status == "paid":
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"payment_status": status.payment_status, "status": status.status}},
        )
        device_id = (tx.get("metadata") or {}).get("device_id") or tx.get("device_id")
        plan_id = (tx.get("metadata") or {}).get("plan_id", "yearly_haulsafe")
        days = SUBSCRIPTION_PLANS.get(plan_id, {}).get("days", 365)
        from datetime import timedelta
        expires_at = datetime.now(timezone.utc) + timedelta(days=days)
        await db.subscriptions.update_one(
            {"device_id": device_id},
            {"$set": {"status": "active", "expires_at": expires_at, "plan_id": plan_id, "device_id": device_id}},
            upsert=True,
        )
    return {"payment_status": status.payment_status, "status": status.status, "amount_total": status.amount_total, "currency": status.currency}

@api_router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    api_key = os.environ.get("STRIPE_API_KEY")
    host = str(request.base_url).rstrip("/")
    stripe = StripeCheckout(api_key=api_key, webhook_url=f"{host}/api/webhook/stripe")
    try:
        ev = await stripe.handle_webhook(body, request.headers.get("Stripe-Signature"))
    except Exception as e:
        logger.warning(f"webhook error: {e}")
        return {"ok": False}
    if ev.payment_status == "paid":
        device_id = (ev.metadata or {}).get("device_id")
        plan_id = (ev.metadata or {}).get("plan_id", "yearly_haulsafe")
        if device_id:
            from datetime import timedelta
            days = SUBSCRIPTION_PLANS.get(plan_id, {}).get("days", 365)
            await db.subscriptions.update_one(
                {"device_id": device_id},
                {"$set": {"status": "active", "expires_at": datetime.now(timezone.utc) + timedelta(days=days), "plan_id": plan_id, "device_id": device_id}},
                upsert=True,
            )
            await db.payment_transactions.update_one({"session_id": ev.session_id}, {"$set": {"payment_status": "paid", "status": "complete"}})
    return {"ok": True}

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

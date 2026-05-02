"""HAULSAFE HGV Route API - backend test suite."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://route-safety-hgv.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEVICE_ID = f"TEST_{uuid.uuid4()}"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# -------- Root health --------
class TestHealth:
    def test_root(self, session):
        r = session.get(f"{API}/", timeout=15)
        assert r.status_code == 200
        assert "message" in r.json()


# -------- Truck profile --------
class TestTruckProfile:
    def test_auto_create_default_profile(self, session):
        r = session.get(f"{API}/truck-profile/{DEVICE_ID}", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["device_id"] == DEVICE_ID
        assert data["vehicle_type"] == "HGV"
        assert data["height_m"] == 4.5
        assert data["weight_t"] == 44.0
        assert data["width_m"] == 2.55
        assert data["axles"] == 5
        assert data["hazmat"] is False

    def test_update_profile(self, session):
        payload = {
            "device_id": DEVICE_ID,
            "name": "TEST_Truck",
            "vehicle_type": "LGV",
            "height_m": 3.2,
            "weight_t": 7.5,
            "hazmat": True,
            "avoid_motorways": True,
        }
        r = session.put(f"{API}/truck-profile", json=payload, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["vehicle_type"] == "LGV"
        assert data["height_m"] == 3.2
        assert data["weight_t"] == 7.5
        assert data["hazmat"] is True
        assert data["avoid_motorways"] is True

        # verify persistence via GET
        r2 = session.get(f"{API}/truck-profile/{DEVICE_ID}", timeout=15)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["name"] == "TEST_Truck"
        assert d2["height_m"] == 3.2


# -------- Geocode --------
class TestGeocode:
    def test_geocode_manchester(self, session):
        r = session.get(f"{API}/geocode", params={"q": "manchester"}, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "results" in data
        assert len(data["results"]) > 0
        first = data["results"][0]
        assert "display_name" in first
        assert "lat" in first and "lng" in first
        assert isinstance(first["lat"], float)

    def test_geocode_too_short(self, session):
        r = session.get(f"{API}/geocode", params={"q": "a"}, timeout=10)
        assert r.status_code == 422


# -------- Routing --------
LONDON = {"lat": 51.5074, "lng": -0.1278}
MANCHESTER = {"lat": 53.4808, "lng": -2.2426}


class TestRoute:
    def test_route_london_manchester(self, session):
        r = session.post(f"{API}/route", json={"origin": LONDON, "destination": MANCHESTER}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "geometry" in data and len(data["geometry"]) > 10
        # geometry should be [lat, lng]
        first = data["geometry"][0]
        assert 49 < first[0] < 56  # UK lat range
        assert -6 < first[1] < 2
        assert data["distance_m"] > 100000  # ~300km
        assert data["duration_s"] > 3600
        assert isinstance(data["steps"], list) and len(data["steps"]) > 0
        # save for later
        pytest.route_geometry = data["geometry"]


# -------- Route Analysis --------
class TestRouteAnalysis:
    def test_analysis_with_hgv_profile(self, session):
        geometry = getattr(pytest, "route_geometry", None)
        if not geometry:
            r = session.post(f"{API}/route", json={"origin": LONDON, "destination": MANCHESTER}, timeout=30)
            assert r.status_code == 200
            geometry = r.json()["geometry"]

        profile = {
            "id": str(uuid.uuid4()),
            "device_id": DEVICE_ID,
            "name": "TEST_HGV",
            "vehicle_type": "HGV",
            "height_m": 4.5,
            "width_m": 2.55,
            "length_m": 16.5,
            "weight_t": 44.0,
            "axles": 5,
            "hazmat": False,
            "avoid_tolls": False,
            "avoid_motorways": False,
        }
        payload = {"coordinates": geometry, "profile": profile}
        r = session.post(f"{API}/route-analysis", json=payload, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "warnings" in data
        assert "weather" in data
        assert "summary" in data
        s = data["summary"]
        assert "total_warnings" in s
        assert "critical_warnings" in s
        assert "max_wind_kmh" in s
        assert isinstance(data["warnings"], list)
        assert isinstance(data["weather"], list)
        # Weather points should exist (Open-Meteo reliable)
        assert len(data["weather"]) >= 1
        wp = data["weather"][0]
        assert "wind_kmh" in wp
        assert "gust_kmh" in wp
        assert wp["severity"] in ("ok", "warning", "danger")
        # warning structure
        if data["warnings"]:
            w = data["warnings"][0]
            for k in ("type", "value", "unit", "critical", "lat", "lng"):
                assert k in w

    def test_analysis_critical_flag_for_tall_truck(self, session):
        # tiny coordinate range is fine for structural test; we just want to see schema
        coords = [[51.5074, -0.1278], [51.51, -0.12], [51.52, -0.11]]
        profile = {
            "id": str(uuid.uuid4()),
            "device_id": DEVICE_ID,
            "name": "TEST_BigRig",
            "vehicle_type": "HGV",
            "height_m": 5.5,  # very tall -> would exceed 4.4m bridges
            "width_m": 3.0,
            "length_m": 20.0,
            "weight_t": 50.0,
            "axles": 6,
            "hazmat": False,
            "avoid_tolls": False,
            "avoid_motorways": False,
        }
        r = session.post(f"{API}/route-analysis", json={"coordinates": coords, "profile": profile}, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        # schema present
        assert "warnings" in data and "summary" in data
        # If any warnings with maxheight < 5.5 -> critical must be true
        for w in data["warnings"]:
            if w["type"] == "maxheight" and w["value"] is not None and w["value"] < 5.5:
                assert w["critical"] is True

    def test_analysis_rejects_short_coords(self, session):
        r = session.post(f"{API}/route-analysis", json={"coordinates": [[51.5, -0.1]]}, timeout=10)
        assert r.status_code == 400

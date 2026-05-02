import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Platform,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import AsyncStorage from "@react-native-async-storage/async-storage";

// On web, react-native-webview is unsupported. We render a real <iframe> via React.createElement('iframe', ...)
const isWeb = Platform.OS === "web";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const { height: SCREEN_H } = Dimensions.get("window");

type LatLng = { lat: number; lng: number };
type GeoResult = { display_name: string; lat: number; lng: number; type?: string };
type RouteResp = {
  geometry: number[][];
  distance_m: number;
  duration_s: number;
  steps: { instruction: string; type: string; modifier?: string; distance_m: number; duration_s: number; name: string }[];
};
type Warning = {
  type: string;
  label: string;
  value: number | null;
  unit: string;
  name: string;
  lat: number;
  lng: number;
  distance_km: number;
  critical: boolean;
  bridge: boolean;
};
type WeatherPt = {
  lat: number;
  lng: number;
  temperature_c: number;
  wind_kmh: number;
  gust_kmh: number;
  wind_direction: number;
  precipitation_mm: number;
  visibility_m: number | null;
  weather_code: number;
  severity: "ok" | "warning" | "danger";
  index: number;
};

function fmtDist(m: number) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}
function fmtDur(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

const LEAFLET_HTML = `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="initial-scale=1.0,maximum-scale=1.0,user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#0A0A0A;}
  .leaflet-control-attribution{background:rgba(0,0,0,0.5)!important;color:#aaa!important;font-size:9px;}
  .leaflet-control-attribution a{color:#7ab!important;}
  .warn-icon{background:#FF3B30;border:2px solid #fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:13px;box-shadow:0 0 0 3px rgba(255,59,48,0.25);}
  .warn-icon.amber{background:#FF9F0A;box-shadow:0 0 0 3px rgba(255,159,10,0.25);}
  .pin-start, .pin-end{width:18px;height:18px;border-radius:50%;border:3px solid #fff;}
  .pin-start{background:#32D74B;box-shadow:0 0 0 4px rgba(50,215,75,0.3);}
  .pin-end{background:#007AFF;box-shadow:0 0 0 4px rgba(0,122,255,0.3);}
</style>
</head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const map = L.map('map', { zoomControl:false, attributionControl:true }).setView([51.5074, -0.1278], 6);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    subdomains:'abcd', maxZoom:19, attribution:'© OSM © CARTO'
  }).addTo(map);

  let routeLayer=null, startMarker=null, endMarker=null, warnLayer=null;

  function send(type, data){
    if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify({type,data}));}
  }

  function clearAll(){
    if(routeLayer){map.removeLayer(routeLayer); routeLayer=null;}
    if(startMarker){map.removeLayer(startMarker); startMarker=null;}
    if(endMarker){map.removeLayer(endMarker); endMarker=null;}
    if(warnLayer){map.removeLayer(warnLayer); warnLayer=null;}
  }

  function setRoute(coords, warnings){
    clearAll();
    if(!coords||coords.length<2)return;
    routeLayer = L.polyline(coords, {color:'#007AFF', weight:6, opacity:0.95}).addTo(map);
    const outline = L.polyline(coords, {color:'#0A0A0A', weight:10, opacity:0.5});
    outline.addTo(map); outline.bringToBack();
    startMarker = L.marker(coords[0], {icon: L.divIcon({className:'',html:'<div class="pin-start"></div>',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(map);
    endMarker = L.marker(coords[coords.length-1], {icon: L.divIcon({className:'',html:'<div class="pin-end"></div>',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(map);

    warnLayer = L.layerGroup();
    (warnings||[]).forEach(w=>{
      const cls = w.critical ? 'warn-icon' : 'warn-icon amber';
      const ch = w.type==='maxheight'?'H':w.type==='maxweight'?'W':w.type==='maxwidth'?'⇔':w.type==='maxlength'?'⇕':'!';
      const m = L.marker([w.lat,w.lng],{icon:L.divIcon({className:'',html:'<div class="'+cls+'">'+ch+'</div>',iconSize:[22,22],iconAnchor:[11,11]})});
      m.on('click',()=>send('warning_tap', w));
      m.addTo(warnLayer);
    });
    warnLayer.addTo(map);

    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, {padding:[60,60]});
  }

  function recenter(){ if(routeLayer){map.fitBounds(routeLayer.getBounds(),{padding:[60,60]});} }

  document.addEventListener('message', handle);
  window.addEventListener('message', handle);
  function handle(e){
    try{
      const msg = JSON.parse(e.data);
      if(msg.type==='setRoute') setRoute(msg.coords, msg.warnings);
      if(msg.type==='clear') clearAll();
      if(msg.type==='recenter') recenter();
    }catch(err){}
  }
  send('ready', {});
</script>
</body></html>`;

export default function MapScreen() {
  const router = useRouter();
  const webRef = useRef<WebView>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [destination, setDestination] = useState<GeoResult | null>(null);
  const [origin, setOrigin] = useState<LatLng>({ lat: 51.5074, lng: -0.1278 }); // London default
  const [originName, setOriginName] = useState<string>("Current location");
  const [route, setRoute] = useState<RouteResp | null>(null);
  const [analysis, setAnalysis] = useState<{
    warnings: Warning[];
    weather: WeatherPt[];
    summary: { total_warnings: number; critical_warnings: number; high_wind_alert: boolean; max_wind_kmh: number };
  } | null>(null);
  const [planning, setPlanning] = useState(false);
  const [webReady, setWebReady] = useState(false);
  const [showSheet, setShowSheet] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [altRoute, setAltRoute] = useState<RouteResp | null>(null);
  const [altWarnings, setAltWarnings] = useState<Warning[]>([]);
  const [showSafer, setShowSafer] = useState(false);
  const [sub, setSub] = useState<{ active: boolean; status: string; is_trial: boolean; expires_at: string } | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [paying, setPaying] = useState(false);

  const refreshSub = async (deviceId: string) => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/subscription/${deviceId}`);
      if (r.ok) setSub(await r.json());
    } catch {}
  };

  useEffect(() => {
    (async () => {
      let id = await AsyncStorage.getItem("device_id");
      if (!id) {
        id = "dev_" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
        await AsyncStorage.setItem("device_id", id);
      }
      try {
        const r = await fetch(`${BACKEND_URL}/api/truck-profile/${id}`);
        if (r.ok) setProfile(await r.json());
      } catch {}
      refreshSub(id);
    })();

    // Detect Stripe return on web
    if (isWeb && typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const sid = params.get("session_id");
      if (sid) {
        (async () => {
          for (let i = 0; i < 8; i++) {
            try {
              const r = await fetch(`${BACKEND_URL}/api/payments/checkout/status/${sid}`);
              const d = await r.json();
              if (d.payment_status === "paid") {
                const id = await AsyncStorage.getItem("device_id");
                if (id) await refreshSub(id);
                window.history.replaceState({}, "", "/map");
                return;
              }
              if (d.status === "expired") return;
            } catch {}
            await new Promise((res) => setTimeout(res, 2000));
          }
        })();
      }
    }
  }, []);

  // Debounced geocode
  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`${BACKEND_URL}/api/geocode?q=${encodeURIComponent(query)}`);
        const d = await r.json();
        setResults(d.results || []);
      } catch (e) {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const iframeRef = useRef<any>(null);
  const sendToWeb = (msg: any) => {
    if (isWeb) {
      try {
        iframeRef.current?.contentWindow?.postMessage(JSON.stringify(msg), "*");
      } catch {}
    } else {
      webRef.current?.postMessage(JSON.stringify(msg));
    }
  };

  useEffect(() => {
    if (!isWeb) return;
    const handler = (e: MessageEvent) => {
      try {
        const m = typeof e.data === "string" ? JSON.parse(e.data) : null;
        if (m?.type === "ready") setWebReady(true);
      } catch {}
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const planRoute = async (dest: GeoResult) => {
    if (sub && !sub.active) {
      setShowPaywall(true);
      return;
    }
    setPlanning(true);
    setRoute(null);
    setAnalysis(null);
    setAltRoute(null);
    setAltWarnings([]);
    setShowSafer(false);
    try {
      const r = await fetch(`${BACKEND_URL}/api/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin,
          destination: { lat: dest.lat, lng: dest.lng },
          alternatives: true,
        }),
      });
      if (!r.ok) throw new Error("route failed");
      const data = await r.json();
      const primary: RouteResp = {
        geometry: data.geometry,
        distance_m: data.distance_m,
        duration_s: data.duration_s,
        steps: data.steps,
      };
      setRoute(primary);

      // Fetch analysis for primary
      const ar = await fetch(`${BACKEND_URL}/api/route-analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: data.geometry, profile }),
      });
      const adata = await ar.json();
      setAnalysis(adata);
      sendToWeb({ type: "setRoute", coords: data.geometry, warnings: adata.warnings || [] });

      // If critical warnings, analyse alternatives to find safer
      if ((adata.summary?.critical_warnings ?? 0) > 0 && Array.isArray(data.alternatives) && data.alternatives.length > 0) {
        for (const alt of data.alternatives) {
          try {
            const ar2 = await fetch(`${BACKEND_URL}/api/route-analysis`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ coordinates: alt.geometry, profile }),
            });
            const adata2 = await ar2.json();
            const altCrit = adata2.summary?.critical_warnings ?? 0;
            if (altCrit < (adata.summary?.critical_warnings ?? 0)) {
              setAltRoute({
                geometry: alt.geometry,
                distance_m: alt.distance_m,
                duration_s: alt.duration_s,
                steps: alt.steps,
              });
              setAltWarnings(adata2.warnings || []);
              setShowSafer(true);
              break;
            }
          } catch {}
        }
      }
    } catch (e) {
      console.warn(e);
    } finally {
      setPlanning(false);
    }
  };

  const switchToSaferRoute = () => {
    if (!altRoute) return;
    setRoute(altRoute);
    setAnalysis((a) => a ? { ...a, warnings: altWarnings, summary: { ...a.summary, total_warnings: altWarnings.length, critical_warnings: altWarnings.filter(w => w.critical).length } } : a);
    sendToWeb({ type: "setRoute", coords: altRoute.geometry, warnings: altWarnings });
    setShowSafer(false);
    setAltRoute(null);
  };

  const startCheckout = async () => {
    setPaying(true);
    try {
      const id = (await AsyncStorage.getItem("device_id")) || "";
      const origin_url = isWeb && typeof window !== "undefined"
        ? window.location.origin
        : (BACKEND_URL || "");
      const r = await fetch(`${BACKEND_URL}/api/payments/checkout/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: id, plan_id: "yearly_haulsafe", origin_url }),
      });
      const d = await r.json();
      if (d.url && isWeb && typeof window !== "undefined") {
        window.location.href = d.url;
      }
    } catch (e) {
      console.warn(e);
    } finally {
      setPaying(false);
    }
  };

  const onSelectDest = (g: GeoResult) => {
    setDestination(g);
    setQuery(g.display_name.split(",")[0]);
    setResults([]);
    planRoute(g);
  };

  const clearRoute = () => {
    setRoute(null);
    setAnalysis(null);
    setDestination(null);
    setQuery("");
    sendToWeb({ type: "clear" });
  };

  const maxWind = analysis?.summary.max_wind_kmh ?? 0;
  const windSeverity =
    maxWind >= 80 ? "danger" : maxWind >= 50 ? "warning" : "ok";

  return (
    <View style={styles.root} testID="map-screen">
      {isWeb ? (
        // @ts-ignore - iframe is HTMLElement on web only
        React.createElement("iframe", {
          ref: iframeRef,
          srcDoc: LEAFLET_HTML,
          style: {
            border: "0",
            width: "100%",
            height: "100%",
            backgroundColor: "#0A0A0A",
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          },
          "data-testid": "leaflet-map-iframe",
        })
      ) : (
        <WebView
          ref={webRef}
          originWhitelist={["*"]}
          source={{ html: LEAFLET_HTML }}
          style={styles.web}
          onMessage={(e) => {
            try {
              const m = JSON.parse(e.nativeEvent.data);
              if (m.type === "ready") setWebReady(true);
            } catch {}
          }}
          javaScriptEnabled
          domStorageEnabled
          androidLayerType="hardware"
        />
      )}

      {/* Top search bar */}
      <SafeAreaView style={styles.topOverlay} edges={["top"]} pointerEvents="box-none">
        <View style={styles.searchBar}>
          <TouchableOpacity
            style={styles.iconBtnSmall}
            onPress={() => router.push("/profile")}
            testID="open-profile-btn"
          >
            <MaterialCommunityIcons name="truck-outline" size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.searchInputWrap}>
            <Feather name="search" size={16} color="#8E8E93" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Where to?"
              placeholderTextColor="#8E8E93"
              style={styles.searchInput}
              returnKeyType="search"
              testID="search-input"
            />
            {searching ? <ActivityIndicator size="small" color="#8E8E93" /> : null}
            {query.length > 0 ? (
              <TouchableOpacity onPress={clearRoute} testID="clear-search-btn">
                <Feather name="x" size={18} color="#8E8E93" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {results.length > 0 && (
          <ScrollView
            style={styles.resultsBox}
            keyboardShouldPersistTaps="handled"
            testID="search-results"
          >
            {results.map((r, i) => (
              <TouchableOpacity
                key={i}
                style={styles.resultRow}
                onPress={() => onSelectDest(r)}
                testID={`result-${i}`}
              >
                <Feather name="map-pin" size={16} color="#007AFF" />
                <Text style={styles.resultText} numberOfLines={2}>
                  {r.display_name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Wind strip */}
        {analysis && analysis.weather.length > 0 && (
          <View
            style={[
              styles.windStrip,
              windSeverity === "danger" && styles.windStripDanger,
              windSeverity === "warning" && styles.windStripWarn,
            ]}
            testID="wind-strip"
          >
            <MaterialCommunityIcons
              name="weather-windy"
              size={20}
              color={
                windSeverity === "danger"
                  ? "#FF3B30"
                  : windSeverity === "warning"
                  ? "#FF9F0A"
                  : "#32D74B"
              }
            />
            <Text style={styles.windLabel}>WIND AHEAD</Text>
            <Text style={styles.windValue}>{Math.round(maxWind)} km/h</Text>
            <Text style={styles.windNote}>
              {windSeverity === "danger"
                ? "DANGER · Pull over"
                : windSeverity === "warning"
                ? "Caution · High side"
                : "Clear"}
            </Text>
          </View>
        )}
      </SafeAreaView>

      {/* Right side controls */}
      <View style={styles.rightCtrls} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.fab}
          onPress={() => sendToWeb({ type: "recenter" })}
          testID="recenter-btn"
        >
          <Feather name="crosshair" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Bottom sheet */}
      <SafeAreaView style={styles.bottomWrap} edges={["bottom"]} pointerEvents="box-none">
        {planning && (
          <View style={styles.planningBox} testID="planning-box">
            <ActivityIndicator color="#007AFF" />
            <Text style={styles.planningText}>Analyzing route…</Text>
          </View>
        )}

        {!planning && route && (
          <View style={styles.sheet}>
            <TouchableOpacity
              style={styles.sheetHandle}
              onPress={() => setShowSheet((s) => !s)}
              testID="sheet-toggle"
            >
              <View style={styles.handleBar} />
            </TouchableOpacity>

            <View style={styles.sheetSummary}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>ETA</Text>
                <Text style={styles.summaryValue}>{fmtDur(route.duration_s)}</Text>
              </View>
              <View style={styles.summaryDiv} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>DIST</Text>
                <Text style={styles.summaryValue}>{fmtDist(route.distance_m)}</Text>
              </View>
              <View style={styles.summaryDiv} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>ALERTS</Text>
                <Text
                  style={[
                    styles.summaryValue,
                    (analysis?.summary.critical_warnings ?? 0) > 0 && {
                      color: "#FF3B30",
                    },
                  ]}
                >
                  {analysis?.summary.total_warnings ?? 0}
                </Text>
              </View>
            </View>

            {(analysis?.summary.critical_warnings ?? 0) > 0 && (
              <View style={styles.criticalBanner} testID="critical-banner">
                <MaterialCommunityIcons name="alert-octagon" size={20} color="#FF3B30" />
                <Text style={styles.criticalText}>
                  {analysis?.summary.critical_warnings} restriction
                  {(analysis?.summary.critical_warnings ?? 0) > 1 ? "s" : ""} exceed
                  your truck profile
                </Text>
              </View>
            )}

            {showSheet && (
              <ScrollView
                style={styles.sheetScroll}
                contentContainerStyle={{ paddingBottom: 20 }}
                showsVerticalScrollIndicator={false}
              >
                {/* Warnings list */}
                {analysis && analysis.warnings.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>SAFETY ALERTS</Text>
                    {analysis.warnings.slice(0, 12).map((w, i) => (
                      <WarningCard key={i} w={w} />
                    ))}
                  </View>
                )}
                {analysis && analysis.warnings.length === 0 && (
                  <View style={styles.cleanBanner}>
                    <MaterialCommunityIcons
                      name="shield-check"
                      size={20}
                      color="#32D74B"
                    />
                    <Text style={styles.cleanText}>
                      No HGV restrictions detected on this route
                    </Text>
                  </View>
                )}

                {/* Weather along route */}
                {analysis && analysis.weather.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>WEATHER ALONG ROUTE</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ gap: 10 }}
                    >
                      {analysis.weather.map((p, i) => (
                        <WeatherCard key={i} p={p} total={analysis.weather.length} />
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* Turn-by-turn */}
                {route.steps.length > 0 && (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>DIRECTIONS</Text>
                    {route.steps.slice(0, 30).map((s, i) => (
                      <View key={i} style={styles.stepRow}>
                        <View style={styles.stepIcon}>
                          <MaterialCommunityIcons
                            name={maneuverIcon(s.type, s.modifier) as any}
                            size={18}
                            color="#007AFF"
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.stepText} numberOfLines={2}>
                            {s.instruction}
                          </Text>
                          <Text style={styles.stepDist}>
                            {fmtDist(s.distance_m)}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            )}

            <TouchableOpacity
              style={styles.endBtn}
              onPress={clearRoute}
              testID="end-route-btn"
            >
              <Feather name="x-circle" size={18} color="#fff" />
              <Text style={styles.endText}>END ROUTE</Text>
            </TouchableOpacity>
          </View>
        )}

        {!planning && !route && (
          <View style={styles.hintBox}>
            <MaterialCommunityIcons name="map-search-outline" size={20} color="#8E8E93" />
            <Text style={styles.hintText}>
              Search a destination to plan a truck-safe route
            </Text>
          </View>
        )}

        {showSafer && altRoute && (
          <View style={[styles.saferBanner, { margin: 12 }]} testID="safer-banner">
            <MaterialCommunityIcons name="shield-alert" size={22} color="#FF3B30" />
            <View style={{ flex: 1 }}>
              <Text style={styles.saferTitle}>DANGER ahead — switch route?</Text>
              <Text style={styles.saferSub}>
                Safer route: {fmtDist(altRoute.distance_m)} · {fmtDur(altRoute.duration_s)}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.saferBtn}
              onPress={switchToSaferRoute}
              testID="use-safer-route-btn"
            >
              <Text style={styles.saferBtnText}>USE SAFER</Text>
            </TouchableOpacity>
          </View>
        )}

        {sub && sub.is_trial && (
          <TouchableOpacity
            style={[styles.trialBanner, { marginHorizontal: 12, marginBottom: 8 }]}
            onPress={() => setShowPaywall(true)}
            testID="trial-banner"
          >
            <MaterialCommunityIcons name="clock-fast" size={16} color="#FF9F0A" />
            <Text style={styles.trialText}>
              Free trial · ends {new Date(sub.expires_at).toLocaleDateString()}
            </Text>
            <Text style={styles.trialCta}>Renew £120/yr →</Text>
          </TouchableOpacity>
        )}
        {sub && !sub.active && (
          <TouchableOpacity
            style={[styles.trialBanner, { marginHorizontal: 12, marginBottom: 8, borderColor: "rgba(255,59,48,0.5)" }]}
            onPress={() => setShowPaywall(true)}
            testID="expired-banner"
          >
            <MaterialCommunityIcons name="lock" size={16} color="#FF3B30" />
            <Text style={[styles.trialText, { color: "#FF3B30" }]}>
              Subscription expired
            </Text>
            <Text style={styles.trialCta}>Renew £120 →</Text>
          </TouchableOpacity>
        )}
      </SafeAreaView>

      {showPaywall && (
        <View style={styles.paywallOverlay} testID="paywall">
          <View style={styles.paywallCard}>
            <View style={styles.paywallIcon}>
              <MaterialCommunityIcons name="truck-fast" size={36} color="#007AFF" />
            </View>
            <Text style={styles.paywallTitle}>HaulSafe Pro</Text>
            <Text style={styles.paywallSub}>
              Unlimited truck-aware routes, live road safety alerts, weather along the route, and auto-rerouting around low bridges & weight limits.
            </Text>
            <View style={styles.paywallPriceBox}>
              <Text style={styles.paywallPrice}>£120</Text>
              <Text style={styles.paywallPeriod}>/ year</Text>
            </View>
            <TouchableOpacity
              style={styles.paywallBtn}
              onPress={startCheckout}
              disabled={paying}
              testID="start-checkout-btn"
            >
              <Text style={styles.paywallBtnText}>
                {paying ? "OPENING CHECKOUT…" : "SUBSCRIBE NOW"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowPaywall(false)} testID="close-paywall">
              <Text style={styles.paywallClose}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

function maneuverIcon(type: string, mod?: string) {
  if (type === "depart") return "play-circle-outline";
  if (type === "arrive") return "flag-checkered";
  if (type === "roundabout" || type === "rotary") return "rotate-right";
  if (mod?.includes("left")) return "arrow-top-left";
  if (mod?.includes("right")) return "arrow-top-right";
  if (mod?.includes("straight") || type === "continue") return "arrow-up";
  return "arrow-up-thin";
}

function WarningCard({ w }: { w: Warning }) {
  const color = w.critical ? "#FF3B30" : "#FF9F0A";
  const icon =
    w.type === "maxheight"
      ? "arrow-collapse-vertical"
      : w.type === "maxweight"
      ? "weight-kilogram"
      : w.type === "maxwidth"
      ? "arrow-collapse-horizontal"
      : w.type === "maxlength"
      ? "arrow-collapse"
      : w.type === "hazmat"
      ? "biohazard"
      : "alert-circle";
  return (
    <View style={[styles.warnCard, { borderColor: color + "55" }]}>
      <View style={[styles.warnIconBox, { backgroundColor: color + "22" }]}>
        <MaterialCommunityIcons name={icon as any} size={20} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.warnTitle}>
          {w.label}
          {w.value !== null ? ` ${w.value}${w.unit}` : ""}
          {w.bridge ? " · BRIDGE" : ""}
        </Text>
        <Text style={styles.warnSub} numberOfLines={1}>
          {w.name} · {w.distance_km} km from route
        </Text>
      </View>
      {w.critical && (
        <View style={styles.criticalPill}>
          <Text style={styles.criticalPillText}>EXCEEDS</Text>
        </View>
      )}
    </View>
  );
}

function WeatherCard({ p, total }: { p: WeatherPt; total: number }) {
  const color =
    p.severity === "danger" ? "#FF3B30" : p.severity === "warning" ? "#FF9F0A" : "#32D74B";
  const labelStage =
    p.index === 0 ? "Start" : p.index >= total - 1 ? "End" : `WP ${p.index}`;
  return (
    <View style={[styles.wxCard, { borderColor: color + "44" }]}>
      <Text style={styles.wxStage}>{labelStage}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <MaterialCommunityIcons name="weather-windy" size={16} color={color} />
        <Text style={[styles.wxWind, { color }]}>{Math.round(p.wind_kmh)}</Text>
        <Text style={styles.wxUnit}>km/h</Text>
      </View>
      <Text style={styles.wxGust}>Gust {Math.round(p.gust_kmh)}</Text>
      <View style={styles.wxRow}>
        <MaterialCommunityIcons name="thermometer" size={12} color="#8E8E93" />
        <Text style={styles.wxMeta}>{Math.round(p.temperature_c)}°</Text>
      </View>
      <View style={styles.wxRow}>
        <MaterialCommunityIcons name="weather-pouring" size={12} color="#8E8E93" />
        <Text style={styles.wxMeta}>{p.precipitation_mm.toFixed(1)} mm</Text>
      </View>
      {p.visibility_m !== null && (
        <View style={styles.wxRow}>
          <MaterialCommunityIcons name="eye-outline" size={12} color="#8E8E93" />
          <Text style={styles.wxMeta}>
            {p.visibility_m >= 1000 ? `${Math.round(p.visibility_m / 1000)} km` : `${p.visibility_m} m`}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0A0A" },
  web: { flex: 1, backgroundColor: "#0A0A0A" },
  topOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  iconBtnSmall: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 48,
    backgroundColor: "#1C1C1E",
    borderRadius: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
    padding: 0,
  },
  resultsBox: {
    maxHeight: 260,
    backgroundColor: "#1C1C1E",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingVertical: 4,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  resultText: { flex: 1, color: "#fff", fontSize: 13, lineHeight: 18 },
  windStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(28,28,30,0.95)",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(50,215,75,0.3)",
  },
  windStripWarn: { borderColor: "rgba(255,159,10,0.5)", backgroundColor: "rgba(60,40,10,0.95)" },
  windStripDanger: { borderColor: "rgba(255,59,48,0.6)", backgroundColor: "rgba(60,15,15,0.95)" },
  windLabel: { color: "#8E8E93", fontSize: 10, letterSpacing: 1.5, fontWeight: "800" },
  windValue: { color: "#fff", fontSize: 18, fontWeight: "900", letterSpacing: -0.5 },
  windNote: { color: "#fff", fontSize: 11, fontWeight: "700", marginLeft: "auto" },
  rightCtrls: {
    position: "absolute",
    right: 14,
    top: SCREEN_H * 0.45,
    gap: 10,
  },
  fab: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "rgba(28,28,30,0.95)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  bottomWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  planningBox: {
    margin: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#1C1C1E",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  planningText: { color: "#fff", fontWeight: "700" },
  hintBox: {
    margin: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "rgba(28,28,30,0.92)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  hintText: { color: "#8E8E93", fontSize: 13, flex: 1 },
  sheet: {
    backgroundColor: "#0F0F10",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    maxHeight: SCREEN_H * 0.6,
  },
  sheetHandle: { alignItems: "center", paddingTop: 8, paddingBottom: 4 },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#3A3A3C",
  },
  sheetSummary: {
    flexDirection: "row",
    paddingHorizontal: 18,
    paddingVertical: 12,
    alignItems: "center",
  },
  summaryItem: { flex: 1 },
  summaryDiv: {
    width: 1,
    height: 36,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginHorizontal: 8,
  },
  summaryLabel: { color: "#8E8E93", fontSize: 10, letterSpacing: 1.5, fontWeight: "800" },
  summaryValue: { color: "#fff", fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
  criticalBanner: {
    marginHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,59,48,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,59,48,0.4)",
    borderRadius: 12,
    padding: 12,
  },
  criticalText: { color: "#FF3B30", fontSize: 13, fontWeight: "700", flex: 1 },
  cleanBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(50,215,75,0.10)",
    borderWidth: 1,
    borderColor: "rgba(50,215,75,0.35)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 6,
  },
  cleanText: { color: "#32D74B", fontSize: 13, fontWeight: "700" },
  sheetScroll: { paddingHorizontal: 14, marginTop: 10 },
  section: { marginBottom: 18 },
  sectionTitle: {
    color: "#8E8E93",
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "800",
    marginBottom: 10,
  },
  warnCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  warnIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  warnTitle: { color: "#fff", fontSize: 14, fontWeight: "800" },
  warnSub: { color: "#8E8E93", fontSize: 12, marginTop: 2 },
  criticalPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(255,59,48,0.18)",
    borderRadius: 6,
  },
  criticalPillText: { color: "#FF3B30", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  wxCard: {
    width: 130,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    gap: 4,
  },
  wxStage: {
    color: "#8E8E93",
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: "800",
    marginBottom: 4,
  },
  wxWind: { fontSize: 22, fontWeight: "900", letterSpacing: -1 },
  wxUnit: { color: "#8E8E93", fontSize: 11, fontWeight: "700" },
  wxGust: { color: "#fff", fontSize: 11, fontWeight: "700", marginBottom: 6 },
  wxRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  wxMeta: { color: "#C7C7CC", fontSize: 11, fontWeight: "600" },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  stepIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(0,122,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  stepDist: { color: "#8E8E93", fontSize: 11, marginTop: 2 },
  endBtn: {
    margin: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 12,
    backgroundColor: "#FF3B30",
  },
  endText: { color: "#fff", fontSize: 13, fontWeight: "900", letterSpacing: 1.5 },
  saferBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(60,15,15,0.96)",
    borderWidth: 1,
    borderColor: "rgba(255,59,48,0.5)",
  },
  saferTitle: { color: "#fff", fontWeight: "900", fontSize: 14 },
  saferSub: { color: "#FFB7B0", fontSize: 11, marginTop: 2 },
  saferBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: "#FF3B30" },
  saferBtnText: { color: "#fff", fontWeight: "900", fontSize: 11, letterSpacing: 1 },
  trialBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "rgba(28,28,30,0.95)",
    borderWidth: 1,
    borderColor: "rgba(255,159,10,0.4)",
  },
  trialText: { color: "#FF9F0A", fontSize: 12, fontWeight: "700", flex: 1 },
  trialCta: { color: "#fff", fontSize: 12, fontWeight: "800" },
  paywallOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.85)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  paywallCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#1C1C1E",
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(0,122,255,0.3)",
  },
  paywallIcon: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: "rgba(0,122,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  paywallTitle: { color: "#fff", fontSize: 26, fontWeight: "900", letterSpacing: -0.5 },
  paywallSub: { color: "#C7C7CC", fontSize: 14, textAlign: "center", marginVertical: 14, lineHeight: 20 },
  paywallPriceBox: { flexDirection: "row", alignItems: "baseline", gap: 4, marginVertical: 8 },
  paywallPrice: { color: "#fff", fontSize: 44, fontWeight: "900", letterSpacing: -1 },
  paywallPeriod: { color: "#8E8E93", fontSize: 16, fontWeight: "700" },
  paywallBtn: { width: "100%", height: 54, borderRadius: 14, backgroundColor: "#007AFF", alignItems: "center", justifyContent: "center", marginTop: 12 },
  paywallBtnText: { color: "#fff", fontSize: 14, fontWeight: "900", letterSpacing: 1.5 },
  paywallClose: { color: "#8E8E93", fontSize: 13, fontWeight: "700", marginTop: 14, padding: 8 },
});

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

export default function SuccessScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ session_id?: string }>();
  const [status, setStatus] = useState<"checking" | "paid" | "pending" | "failed">("checking");
  const [details, setDetails] = useState<{
    amount_total?: number;
    currency?: string;
    expires_at?: string;
  }>({});

  useEffect(() => {
    let attempts = 0;
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      if (!params.session_id) {
        setStatus("failed");
        return;
      }
      if (attempts >= 12) {
        setStatus("pending");
        return;
      }
      attempts++;
      try {
        const r = await fetch(
          `${BACKEND_URL}/api/payments/checkout/status/${params.session_id}`
        );
        const d = await r.json();
        if (d.payment_status === "paid") {
          setDetails({ amount_total: d.amount_total, currency: d.currency });
          const id = await AsyncStorage.getItem("device_id");
          if (id) {
            try {
              const sr = await fetch(`${BACKEND_URL}/api/subscription/${id}`);
              if (sr.ok) {
                const sd = await sr.json();
                setDetails((prev) => ({ ...prev, expires_at: sd.expires_at }));
              }
            } catch {}
          }
          setStatus("paid");
          return;
        }
        if (d.status === "expired") {
          setStatus("failed");
          return;
        }
      } catch {}
      setTimeout(poll, 2500);
    }
    poll();
    return () => {
      cancelled = true;
    };
  }, [params.session_id]);

  const currencySymbol = (details.currency || "gbp").toLowerCase() === "gbp" ? "£" : "$";
  const amountStr = details.amount_total ? `${currencySymbol}${(details.amount_total / 100).toFixed(2)}` : "£120.00";
  const expiresStr = details.expires_at
    ? new Date(details.expires_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
    : "";

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="success-screen">
      <View style={styles.center}>
        {status === "checking" && (
          <>
            <ActivityIndicator color="#007AFF" size="large" />
            <Text style={styles.title}>Confirming payment…</Text>
            <Text style={styles.sub}>This only takes a few seconds.</Text>
          </>
        )}
        {status === "paid" && (
          <>
            <View style={styles.iconOk}>
              <MaterialCommunityIcons name="check-circle" size={80} color="#32D74B" />
            </View>
            <Text style={styles.kicker}>HAULSAFE PRO</Text>
            <Text style={styles.title}>Payment confirmed</Text>
            <Text style={styles.sub}>
              Thank you — your truck-safe routing is unlocked for a full year.
            </Text>
            <View style={styles.receipt}>
              <Row label="Amount" value={amountStr} />
              <Row label="Plan" value="Yearly · Auto-renewing" />
              {expiresStr ? <Row label="Renews on" value={expiresStr} /> : null}
              <Row label="Payment" value="Card · Stripe" />
            </View>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => router.replace("/map")}
              testID="back-to-map-btn"
            >
              <Text style={styles.btnText}>START DRIVING</Text>
              <Feather name="arrow-right" size={20} color="#fff" />
            </TouchableOpacity>
          </>
        )}
        {status === "pending" && (
          <>
            <MaterialCommunityIcons name="clock-outline" size={80} color="#FF9F0A" />
            <Text style={styles.title}>Still processing…</Text>
            <Text style={styles.sub}>
              Your payment is taking longer than usual. Check your email for confirmation.
            </Text>
            <TouchableOpacity style={styles.btn} onPress={() => router.replace("/map")}>
              <Text style={styles.btnText}>BACK TO MAP</Text>
            </TouchableOpacity>
          </>
        )}
        {status === "failed" && (
          <>
            <MaterialCommunityIcons name="alert-circle" size={80} color="#FF3B30" />
            <Text style={styles.title}>Payment not completed</Text>
            <Text style={styles.sub}>Your card wasn't charged. You can try again from the map.</Text>
            <TouchableOpacity style={styles.btn} onPress={() => router.replace("/map")}>
              <Text style={styles.btnText}>BACK TO MAP</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0A0A" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  iconOk: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: "rgba(50,215,75,0.12)",
    alignItems: "center", justifyContent: "center", marginBottom: 20,
  },
  kicker: { color: "#32D74B", fontSize: 11, letterSpacing: 3, fontWeight: "900", marginBottom: 8 },
  title: {
    color: "#fff", fontSize: 30, fontWeight: "900", letterSpacing: -0.5,
    marginTop: 20, textAlign: "center",
  },
  sub: {
    color: "#C7C7CC", fontSize: 15, lineHeight: 22, marginTop: 12,
    textAlign: "center", maxWidth: 320,
  },
  receipt: {
    width: "100%", maxWidth: 360, marginTop: 28,
    backgroundColor: "#1C1C1E", borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  row: {
    flexDirection: "row", justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)",
  },
  rowLabel: { color: "#8E8E93", fontSize: 13, fontWeight: "600" },
  rowValue: { color: "#fff", fontSize: 14, fontWeight: "800" },
  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    marginTop: 32, height: 56, paddingHorizontal: 32,
    backgroundColor: "#007AFF", borderRadius: 16, minWidth: 240,
  },
  btnText: { color: "#fff", fontSize: 14, fontWeight: "900", letterSpacing: 1.5 },
});

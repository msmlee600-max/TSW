import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

type Dashboard = {
  month_revenue: number;
  year_revenue: number;
  total_revenue: number;
  active_subscribers: number;
  total_subscribers: number;
  recent_transactions: {
    amount: number;
    currency: string;
    device_id: string;
    plan_id: string;
    created_at: string;
    status: string;
  }[];
  currency: string;
};

export default function AdminScreen() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Dashboard | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  const unlock = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/admin/dashboard?pin=${encodeURIComponent(pin)}`);
      if (r.status === 401) {
        Alert.alert("Wrong PIN", "Please try again");
        setLoading(false);
        return;
      }
      if (!r.ok) throw new Error("failed");
      const d = await r.json();
      setData(d);
      setUnlocked(true);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Could not load dashboard");
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    if (!unlocked) return;
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/admin/dashboard?pin=${encodeURIComponent(pin)}`);
      if (r.ok) setData(await r.json());
    } catch {}
    setLoading(false);
  };

  if (!unlocked) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]} testID="admin-lock-screen">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <View style={styles.lockHeader}>
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={() => router.back()}
              testID="admin-back-btn"
            >
              <Feather name="arrow-left" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
          <View style={styles.lockCenter}>
            <View style={styles.lockIcon}>
              <MaterialCommunityIcons name="shield-key" size={48} color="#007AFF" />
            </View>
            <Text style={styles.lockKicker}>OWNER DASHBOARD</Text>
            <Text style={styles.lockTitle}>Enter admin PIN</Text>
            <Text style={styles.lockSub}>4-digit PIN set in backend .env</Text>
            <TextInput
              value={pin}
              onChangeText={setPin}
              placeholder="••••"
              placeholderTextColor="#48484A"
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              style={styles.pinInput}
              testID="admin-pin-input"
            />
            <TouchableOpacity
              style={styles.unlockBtn}
              onPress={unlock}
              disabled={loading || pin.length < 3}
              testID="admin-unlock-btn"
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Feather name="unlock" size={18} color="#fff" />
                  <Text style={styles.unlockText}>UNLOCK DASHBOARD</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="admin-dashboard">
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => router.back()}
          testID="admin-home-btn"
        >
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerKicker}>OWNER DASHBOARD</Text>
          <Text style={styles.headerTitle}>HaulSafe Revenue</Text>
        </View>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={refresh}
          testID="admin-refresh-btn"
        >
          <Feather name="refresh-cw" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>THIS MONTH</Text>
          <Text style={styles.heroAmount}>£{(data?.month_revenue ?? 0).toFixed(2)}</Text>
          <Text style={styles.heroSub}>Net revenue · GBP</Text>
        </View>

        <View style={styles.metricRow}>
          <Metric label="THIS YEAR" value={`£${(data?.year_revenue ?? 0).toFixed(0)}`} icon="calendar" />
          <Metric label="ALL TIME" value={`£${(data?.total_revenue ?? 0).toFixed(0)}`} icon="cash-multiple" />
        </View>

        <View style={styles.metricRow}>
          <Metric
            label="ACTIVE SUBS"
            value={String(data?.active_subscribers ?? 0)}
            icon="account-check"
            tone="success"
          />
          <Metric
            label="TOTAL SUBS"
            value={String(data?.total_subscribers ?? 0)}
            icon="account-group"
          />
        </View>

        <Text style={styles.sectionLabel}>RECENT TRANSACTIONS</Text>
        {(!data || data.recent_transactions.length === 0) && (
          <View style={styles.emptyBox}>
            <MaterialCommunityIcons name="inbox-outline" size={28} color="#8E8E93" />
            <Text style={styles.emptyText}>No transactions yet</Text>
            <Text style={styles.emptySub}>They'll appear here as drivers subscribe</Text>
          </View>
        )}
        {data?.recent_transactions.map((t, i) => {
          const ts = new Date(t.created_at).toLocaleString(undefined, {
            day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
          });
          const sym = (t.currency || "gbp").toLowerCase() === "gbp" ? "£" : "$";
          return (
            <View key={i} style={styles.txRow}>
              <View style={styles.txIcon}>
                <MaterialCommunityIcons name="credit-card-check" size={18} color="#32D74B" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.txAmount}>{sym}{t.amount.toFixed(2)}</Text>
                <Text style={styles.txMeta} numberOfLines={1}>
                  {t.device_id?.slice(0, 14)}… · {ts}
                </Text>
              </View>
              <View style={styles.txPill}>
                <Text style={styles.txPillText}>{t.status?.toUpperCase()}</Text>
              </View>
            </View>
          );
        })}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({
  label, value, icon, tone,
}: {
  label: string; value: string; icon: any; tone?: "success";
}) {
  const color = tone === "success" ? "#32D74B" : "#007AFF";
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricIcon, { backgroundColor: color + "20" }]}>
        <MaterialCommunityIcons name={icon} size={18} color={color} />
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0A0A" },
  lockHeader: { padding: 16 },
  lockCenter: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  lockIcon: {
    width: 88, height: 88, borderRadius: 22,
    backgroundColor: "rgba(0,122,255,0.12)",
    alignItems: "center", justifyContent: "center", marginBottom: 20,
    borderWidth: 1, borderColor: "rgba(0,122,255,0.3)",
  },
  lockKicker: { color: "#8E8E93", fontSize: 11, letterSpacing: 3, fontWeight: "900", marginBottom: 8 },
  lockTitle: { color: "#fff", fontSize: 26, fontWeight: "900", letterSpacing: -0.5 },
  lockSub: { color: "#8E8E93", fontSize: 13, marginTop: 6, marginBottom: 28 },
  pinInput: {
    width: 220, height: 64, backgroundColor: "#1C1C1E",
    borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
    textAlign: "center", fontSize: 28, fontWeight: "900",
    color: "#fff", letterSpacing: 8, paddingVertical: 0,
  },
  unlockBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    marginTop: 24, height: 54, paddingHorizontal: 28, minWidth: 240,
    backgroundColor: "#007AFF", borderRadius: 14,
  },
  unlockText: { color: "#fff", fontSize: 14, fontWeight: "900", letterSpacing: 1.5 },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)",
  },
  iconBtn: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: "#1C1C1E",
    alignItems: "center", justifyContent: "center",
  },
  headerKicker: { color: "#8E8E93", fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  headerTitle: { color: "#fff", fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
  scroll: { padding: 20 },
  heroCard: {
    padding: 24, borderRadius: 20,
    backgroundColor: "#1C1C1E",
    borderWidth: 1, borderColor: "rgba(0,122,255,0.25)",
    marginBottom: 14,
  },
  heroLabel: { color: "#007AFF", fontSize: 11, letterSpacing: 2, fontWeight: "900" },
  heroAmount: {
    color: "#fff", fontSize: 54, fontWeight: "900",
    letterSpacing: -2, marginTop: 6,
  },
  heroSub: { color: "#8E8E93", fontSize: 12, fontWeight: "700", marginTop: 4 },
  metricRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  metricCard: {
    flex: 1, padding: 16, borderRadius: 14,
    backgroundColor: "#1C1C1E",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  metricIcon: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: "center", justifyContent: "center", marginBottom: 10,
  },
  metricLabel: { color: "#8E8E93", fontSize: 10, letterSpacing: 1.5, fontWeight: "800" },
  metricValue: { color: "#fff", fontSize: 22, fontWeight: "900", letterSpacing: -0.5, marginTop: 4 },
  sectionLabel: {
    color: "#8E8E93", fontSize: 11, letterSpacing: 2, fontWeight: "800",
    marginTop: 20, marginBottom: 12,
  },
  emptyBox: {
    padding: 30, alignItems: "center",
    backgroundColor: "#1C1C1E", borderRadius: 14,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
  },
  emptyText: { color: "#fff", fontSize: 14, fontWeight: "700", marginTop: 10 },
  emptySub: { color: "#8E8E93", fontSize: 12, marginTop: 4 },
  txRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 12,
    backgroundColor: "#1C1C1E",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.06)",
    marginBottom: 8,
  },
  txIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "rgba(50,215,75,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  txAmount: { color: "#fff", fontSize: 16, fontWeight: "900" },
  txMeta: { color: "#8E8E93", fontSize: 11, marginTop: 2 },
  txPill: {
    paddingHorizontal: 8, paddingVertical: 4,
    backgroundColor: "rgba(50,215,75,0.18)", borderRadius: 6,
  },
  txPillText: { color: "#32D74B", fontSize: 10, fontWeight: "900", letterSpacing: 1 },
});

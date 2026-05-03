import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Switch,
} from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const VEHICLE_TYPES = [
  { key: "HGV", label: "HGV", icon: "truck" },
  { key: "LGV", label: "LGV", icon: "truck-fast" },
  { key: "Truck", label: "Truck", icon: "truck-cargo-container" },
  { key: "Van", label: "Van", icon: "van-utility" },
  { key: "DoubleDecker", label: "Decker", icon: "bus-double-decker" },
  { key: "Coach", label: "Coach", icon: "bus" },
] as const;

// Standard UK / EU dimension presets per vehicle class
const VEHICLE_PRESETS: Record<string, { height_m: string; width_m: string; length_m: string; weight_t: string; axles: string }> = {
  HGV:          { height_m: "4.5",  width_m: "2.55", length_m: "16.5", weight_t: "44",   axles: "5" },
  LGV:          { height_m: "3.0",  width_m: "2.10", length_m: "7.0",  weight_t: "7.5",  axles: "2" },
  Truck:        { height_m: "4.0",  width_m: "2.50", length_m: "12.0", weight_t: "26",   axles: "3" },
  Van:          { height_m: "2.6",  width_m: "2.00", length_m: "5.5",  weight_t: "3.5",  axles: "2" },
  DoubleDecker: { height_m: "4.4",  width_m: "2.55", length_m: "11.5", weight_t: "18",   axles: "2" },
  Coach:        { height_m: "3.8",  width_m: "2.55", length_m: "13.5", weight_t: "18",   axles: "2" },
};

type ProfileState = {
  device_id: string;
  name: string;
  vehicle_type: string;
  height_m: string;
  width_m: string;
  length_m: string;
  weight_t: string;
  axles: string;
  hazmat: boolean;
  avoid_tolls: boolean;
  avoid_motorways: boolean;
};

async function getDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem("device_id");
  if (!id) {
    id = "dev_" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    await AsyncStorage.setItem("device_id", id);
  }
  return id;
}

export default function ProfileScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [p, setP] = useState<ProfileState>({
    device_id: "",
    name: "My Truck",
    vehicle_type: "HGV",
    height_m: "4.5",
    width_m: "2.55",
    length_m: "16.5",
    weight_t: "44",
    axles: "5",
    hazmat: false,
    avoid_tolls: false,
    avoid_motorways: false,
  });

  useEffect(() => {
    (async () => {
      try {
        const id = await getDeviceId();
        const res = await fetch(`${BACKEND_URL}/api/truck-profile/${id}`);
        const data = await res.json();
        setP({
          device_id: id,
          name: data.name ?? "My Truck",
          vehicle_type: data.vehicle_type ?? "HGV",
          height_m: String(data.height_m ?? 4.5),
          width_m: String(data.width_m ?? 2.55),
          length_m: String(data.length_m ?? 16.5),
          weight_t: String(data.weight_t ?? 44),
          axles: String(data.axles ?? 5),
          hazmat: !!data.hazmat,
          avoid_tolls: !!data.avoid_tolls,
          avoid_motorways: !!data.avoid_motorways,
        });
      } catch (e) {
        console.warn("load profile failed", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const update = (k: keyof ProfileState, v: any) => setP((s) => ({ ...s, [k]: v }));

  const save = async (goToMap: boolean) => {
    setSaving(true);
    try {
      const body = {
        device_id: p.device_id,
        name: p.name,
        vehicle_type: p.vehicle_type,
        height_m: parseFloat(p.height_m) || 0,
        width_m: parseFloat(p.width_m) || 0,
        length_m: parseFloat(p.length_m) || 0,
        weight_t: parseFloat(p.weight_t) || 0,
        axles: parseInt(p.axles) || 0,
        hazmat: p.hazmat,
        avoid_tolls: p.avoid_tolls,
        avoid_motorways: p.avoid_motorways,
      };
      const res = await fetch(`${BACKEND_URL}/api/truck-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("save failed");
      if (goToMap) router.replace("/map");
      else Alert.alert("Saved", "Truck profile updated");
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#007AFF" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]} testID="profile-screen">
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => router.back()}
          testID="profile-back-btn"
        >
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerKicker}>STEP 1</Text>
          <Text style={styles.headerTitle}>Truck Profile</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.sectionLabel}>VEHICLE TYPE</Text>
          <View style={[styles.typeRow, { flexWrap: "wrap" }]}>
            {VEHICLE_TYPES.map((v) => {
              const active = p.vehicle_type === v.key;
              return (
                <TouchableOpacity
                  key={v.key}
                  onPress={() => {
                    setP((s) => ({ ...s, vehicle_type: v.key, ...VEHICLE_PRESETS[v.key] }));
                  }}
                  style={[styles.typeBtn, active && styles.typeBtnActive]}
                  testID={`type-${v.key}`}
                >
                  <MaterialCommunityIcons
                    name={v.icon as any}
                    size={26}
                    color={active ? "#007AFF" : "#8E8E93"}
                  />
                  <Text
                    style={[styles.typeLabel, active && { color: "#fff" }]}
                  >
                    {v.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.sectionLabel, { marginTop: 28 }]}>NAME</Text>
          <TextInput
            value={p.name}
            onChangeText={(t) => update("name", t)}
            placeholder="My Truck"
            placeholderTextColor="#48484A"
            style={styles.input}
            testID="input-name"
          />

          <Text style={[styles.sectionLabel, { marginTop: 28 }]}>DIMENSIONS</Text>
          <View style={styles.grid}>
            <NumField
              icon="arrow-expand-vertical"
              label="Height"
              unit="m"
              value={p.height_m}
              onChange={(t) => update("height_m", t)}
              testID="input-height"
            />
            <NumField
              icon="arrow-expand-horizontal"
              label="Width"
              unit="m"
              value={p.width_m}
              onChange={(t) => update("width_m", t)}
              testID="input-width"
            />
            <NumField
              icon="arrow-expand"
              label="Length"
              unit="m"
              value={p.length_m}
              onChange={(t) => update("length_m", t)}
              testID="input-length"
            />
            <NumField
              icon="weight-kilogram"
              label="Weight"
              unit="t"
              value={p.weight_t}
              onChange={(t) => update("weight_t", t)}
              testID="input-weight"
            />
          </View>

          <Text style={[styles.sectionLabel, { marginTop: 28 }]}>AXLES</Text>
          <View style={styles.axlesRow}>
            {[2, 3, 4, 5, 6, 7].map((n) => {
              const active = String(n) === p.axles;
              return (
                <TouchableOpacity
                  key={n}
                  onPress={() => update("axles", String(n))}
                  style={[styles.axleBtn, active && styles.axleBtnActive]}
                  testID={`axle-${n}`}
                >
                  <Text style={[styles.axleText, active && { color: "#fff" }]}>
                    {n}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.sectionLabel, { marginTop: 28 }]}>
            ROUTING PREFERENCES
          </Text>
          <ToggleRow
            icon="biohazard"
            label="Hazardous materials"
            sub="Avoid hazmat-restricted roads"
            value={p.hazmat}
            onChange={(v) => update("hazmat", v)}
            testID="toggle-hazmat"
          />
          <ToggleRow
            icon="cash-multiple"
            label="Avoid tolls"
            sub="Prefer toll-free routes"
            value={p.avoid_tolls}
            onChange={(v) => update("avoid_tolls", v)}
            testID="toggle-tolls"
          />
          <ToggleRow
            icon="highway"
            label="Avoid motorways"
            sub="Use A-roads where possible"
            value={p.avoid_motorways}
            onChange={(v) => update("avoid_motorways", v)}
            testID="toggle-motorways"
          />

          <View style={{ height: 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => save(false)}
          disabled={saving}
          testID="save-profile-btn"
        >
          <Feather name="save" size={20} color="#fff" />
          <Text style={styles.saveText}>{saving ? "SAVING..." : "SAVE"}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.continueBtn}
          onPress={() => save(true)}
          disabled={saving}
          testID="continue-to-map-btn"
        >
          <Text style={styles.continueText}>SAVE & DRIVE</Text>
          <Feather name="arrow-right" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function NumField({
  icon,
  label,
  unit,
  value,
  onChange,
  testID,
}: {
  icon: any;
  label: string;
  unit: string;
  value: string;
  onChange: (t: string) => void;
  testID: string;
}) {
  return (
    <View style={styles.numField}>
      <View style={styles.numHeader}>
        <MaterialCommunityIcons name={icon} size={16} color="#8E8E93" />
        <Text style={styles.numLabel}>{label}</Text>
      </View>
      <View style={styles.numInputRow}>
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          style={styles.numInput}
          testID={testID}
          placeholderTextColor="#48484A"
        />
        <Text style={styles.numUnit}>{unit}</Text>
      </View>
    </View>
  );
}

function ToggleRow({
  icon,
  label,
  sub,
  value,
  onChange,
  testID,
}: {
  icon: any;
  label: string;
  sub: string;
  value: boolean;
  onChange: (v: boolean) => void;
  testID: string;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleIcon}>
        <MaterialCommunityIcons name={icon} size={20} color="#007AFF" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleSub}>{sub}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: "#3A3A3C", true: "#007AFF" }}
        thumbColor="#fff"
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0A0A" },
  loading: {
    flex: 1,
    backgroundColor: "#0A0A0A",
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#1C1C1E",
    alignItems: "center",
    justifyContent: "center",
  },
  headerKicker: { color: "#8E8E93", fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  headerTitle: { color: "#fff", fontSize: 22, fontWeight: "900", letterSpacing: -0.5 },
  scroll: { padding: 20, paddingBottom: 40 },
  sectionLabel: {
    color: "#8E8E93",
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "700",
    marginBottom: 12,
  },
  typeRow: { flexDirection: "row", gap: 10, rowGap: 10 },
  typeBtn: {
    width: "31%",
    height: 90,
    borderRadius: 16,
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  typeBtnActive: {
    borderColor: "#007AFF",
    backgroundColor: "rgba(0,122,255,0.10)",
  },
  typeLabel: {
    color: "#8E8E93",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
  },
  input: {
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    height: 56,
    paddingHorizontal: 16,
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  numField: {
    width: "48%",
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    padding: 14,
  },
  numHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  numLabel: {
    color: "#8E8E93",
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: "700",
  },
  numInputRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  numInput: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -1,
    flex: 1,
    padding: 0,
  },
  numUnit: { color: "#8E8E93", fontSize: 14, fontWeight: "700" },
  axlesRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  axleBtn: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  axleBtnActive: { borderColor: "#007AFF", backgroundColor: "rgba(0,122,255,0.10)" },
  axleText: { color: "#8E8E93", fontSize: 18, fontWeight: "800" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    minHeight: 64,
  },
  toggleIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "rgba(0,122,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  toggleLabel: { color: "#fff", fontSize: 15, fontWeight: "700" },
  toggleSub: { color: "#8E8E93", fontSize: 12, marginTop: 2 },
  footer: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    paddingBottom: Platform.OS === "ios" ? 28 : 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
    backgroundColor: "#0A0A0A",
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 56,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  saveText: { color: "#fff", fontSize: 14, fontWeight: "800", letterSpacing: 1 },
  continueBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 56,
    borderRadius: 14,
    backgroundColor: "#007AFF",
  },
  continueText: { color: "#fff", fontSize: 14, fontWeight: "900", letterSpacing: 1.5 },
});

import React, { useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ImageBackground,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons, Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";

const { height } = Dimensions.get("window");

export default function Index() {
  const router = useRouter();

  return (
    <View style={styles.root} testID="welcome-screen">
      <ImageBackground
        source={{
          uri: "https://images.unsplash.com/photo-1761473573747-91840566ef1c?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NzZ8MHwxfHNlYXJjaHwyfHxkYXJrJTIwaGlnaHdheSUyMGRyaXZpbmclMjBuaWdodHxlbnwwfHx8fDE3Nzc3NDA1Njl8MA&ixlib=rb-4.1.0&q=85",
        }}
        style={styles.bg}
        resizeMode="cover"
      >
        <LinearGradient
          colors={["rgba(10,10,10,0.4)", "rgba(10,10,10,0.95)", "#0A0A0A"]}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
          <View style={styles.topRow}>
            <View style={styles.logoBox}>
              <MaterialCommunityIcons name="truck-fast" size={28} color="#007AFF" />
            </View>
            <Text style={styles.brand}>HAUL<Text style={{ color: "#007AFF" }}>SAFE</Text></Text>
          </View>

          <View style={styles.heroContent}>
            <Text style={styles.kicker}>PROFESSIONAL HGV / LGV</Text>
            <Text style={styles.title}>Drive every mile{"\n"}with confidence.</Text>
            <Text style={styles.subtitle}>
              Truck-aware routing with bridge heights, weight limits, width
              restrictions and live wind & weather alerts ahead of you.
            </Text>

            <View style={styles.featureRow}>
              <FeatureChip icon="bridge" label="Bridge heights" />
              <FeatureChip icon="weight-kilogram" label="Weight limits" />
              <FeatureChip icon="weather-windy" label="Live wind" />
            </View>
          </View>

          <View style={styles.ctaWrap}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => router.push("/profile")}
              testID="setup-truck-btn"
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons name="truck-outline" size={22} color="#fff" />
              <Text style={styles.primaryBtnText}>SET UP TRUCK PROFILE</Text>
              <Feather name="arrow-right" size={20} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.push("/map")}
              testID="skip-to-map-btn"
              activeOpacity={0.7}
            >
              <Text style={styles.secondaryBtnText}>Skip — go straight to map</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

function FeatureChip({ icon, label }: { icon: any; label: string }) {
  return (
    <View style={styles.chip}>
      <MaterialCommunityIcons name={icon} size={16} color="#007AFF" />
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0A0A" },
  bg: { flex: 1, width: "100%", height: "100%" },
  safe: { flex: 1, paddingHorizontal: 24, justifyContent: "space-between" },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
  logoBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "rgba(0,122,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(0,122,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  brand: { color: "#fff", fontSize: 20, fontWeight: "900", letterSpacing: 2 },
  heroContent: { marginBottom: height * 0.05 },
  kicker: {
    color: "#8E8E93",
    fontSize: 12,
    letterSpacing: 4,
    fontWeight: "700",
    marginBottom: 12,
  },
  title: {
    color: "#fff",
    fontSize: 40,
    fontWeight: "900",
    lineHeight: 44,
    letterSpacing: -1,
    marginBottom: 16,
  },
  subtitle: {
    color: "#C7C7CC",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  featureRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(28,28,30,0.85)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  chipText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  ctaWrap: { gap: 12, paddingBottom: 8 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#007AFF",
    height: 60,
    borderRadius: 16,
    paddingHorizontal: 20,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 1.5,
    flex: 1,
    textAlign: "center",
  },
  secondaryBtn: { height: 48, alignItems: "center", justifyContent: "center" },
  secondaryBtnText: { color: "#8E8E93", fontSize: 14, fontWeight: "600" },
  adminLink: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    height: 36,
  },
  adminLinkText: { color: "#48484A", fontSize: 12, fontWeight: "600" },
});

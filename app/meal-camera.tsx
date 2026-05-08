import { C } from "@/constants/colors";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import React, { useRef } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function MealCameraScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  if (!permission) return null;

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permContainer}>
        <Text style={styles.permText}>Camera access is required to capture meals.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelLink} onPress={() => router.back()}>
          <Text style={styles.cancelLinkText}>Cancel</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const handleCapture = async () => {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync();
    if (photo?.uri) {
      router.replace(`/meal-main?image=${encodeURIComponent(photo.uri)}`);
    }
  };

  const handleCancel = () => {
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />

      {/* Cancel — top-left, always visible */}
      <SafeAreaView style={styles.cancelRow} edges={["top"]}>
        <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </SafeAreaView>

      {/* Capture — bottom center */}
      <View style={styles.captureRow}>
        <TouchableOpacity style={styles.captureBtn} onPress={handleCapture}>
          <Text style={styles.captureBtnText}>Capture</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  permContainer: {
    flex: 1,
    backgroundColor: "#0B0F14",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  permText: {
    color: C.text,
    fontSize: 16,
    textAlign: "center",
    marginBottom: 20,
  },
  permBtn: {
    backgroundColor: C.accent,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  permBtnText: {
    color: "#000",
    fontWeight: "600",
    fontSize: 15,
  },
  cancelLink: {
    marginTop: 16,
  },
  cancelLinkText: {
    color: C.muted,
    fontSize: 15,
  },
  cancelRow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  cancelBtn: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  cancelText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
  captureRow: {
    position: "absolute",
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  captureBtn: {
    backgroundColor: C.accent,
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 50,
  },
  captureBtnText: {
    color: "#000",
    fontWeight: "700",
    fontSize: 16,
  },
});

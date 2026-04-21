import { C } from "@/constants/colors";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const FOOD_ITEMS = [
  "salad", "chicken", "rice", "eggs", "beans",
  "yogurt", "paneer", "vegetables", "fruit",
];

export default function MealCaptureScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (item: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(item) ? next.delete(item) : next.add(item);
      return next;
    });
  };

  const handleDone = () => {
    if (selected.size === 0) {
      router.replace("/meal-main");
    } else {
      const prefill = encodeURIComponent([...selected].join(", "));
      router.replace(`/meal-main?prefill=${prefill}`);
    }
  };

  const handleGallery = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      router.replace(`/meal-main?image=${encodeURIComponent(result.assets[0].uri)}`);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.photoBtn} onPress={() => router.push("/meal-camera")}>
        <Text style={styles.photoBtnText}>📸 Take Photo</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.photoBtn} onPress={handleGallery}>
        <Text style={styles.photoBtnText}>🖼️ Choose Photo</Text>
      </TouchableOpacity>
      <Text style={styles.title}>What did you eat?</Text>
      <View style={styles.chips}>
        {FOOD_ITEMS.map((item) => {
          const isSelected = selected.has(item);
          return (
            <TouchableOpacity
              key={item}
              onPress={() => toggle(item)}
              style={[styles.chip, isSelected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                {item}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <TouchableOpacity style={styles.doneBtn} onPress={handleDone}>
        <Text style={styles.doneBtnText}>Done</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F14",
    padding: 20,
  },
  title: {
    color: C.text,
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 24,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "#1E2A38",
  },
  chipSelected: {
    backgroundColor: C.accent,
  },
  chipText: {
    color: C.text,
    fontSize: 15,
  },
  chipTextSelected: {
    color: "#000",
    fontWeight: "600",
  },
  photoBtn: {
    backgroundColor: C.accent,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 20,
  },
  photoBtnText: {
    color: "#000",
    fontWeight: "600",
    fontSize: 15,
  },
  doneBtn: {
    marginTop: 32,
    backgroundColor: C.accent,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  doneBtnText: {
    color: "#000",
    fontWeight: "700",
    fontSize: 16,
  },
});

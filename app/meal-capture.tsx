import AppHeader from "@/components/AppHeader";
import { C } from "@/constants/colors";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

const FOOD_ITEMS = [
  "Rice 1 cup",
  "Chicken 100 g",
  "Chips 50 g",
  "Beans 100 g",
  "Milk 200 ml",
  "Egg 1 piece",
  "Salad 100 g",
  "Yogurt 150 g",
  "Paneer 100 g",
];

export default function MealCaptureScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [input, setInput] = useState("");

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
      router.replace(`/meal-main?prefill=${encodeURIComponent([...selected].join(", "))}`);
    }
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    router.replace(`/meal-main?prefill=${encodeURIComponent(text)}`);
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
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, backgroundColor: "#0B0F14" }}>

        <AppHeader
          rightAction={
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={{ color: C.text, fontSize: 16, fontWeight: "500" }}>Cancel</Text>
            </TouchableOpacity>
          }
        />

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={80}
        >
          <View style={{ flex: 1 }}>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 130 }}
            >

              {/* Photo buttons */}
        <View style={styles.btnWrapper}>
          <View style={styles.btnInner}>
            <TouchableOpacity style={styles.btn} onPress={() => router.push("/meal-camera")}>
              <Text style={styles.btnText}>📸 Take Photo</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.btnWrapper}>
          <View style={styles.btnInner}>
            <TouchableOpacity style={styles.btn} onPress={handleGallery}>
              <Text style={styles.btnText}>🖼️ Choose Photo</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* OR divider */}
        <View style={{ alignItems: "center", marginVertical: 12 }}>
          <Text style={{ color: C.muted }}>— OR —</Text>
        </View>

        {/* Chip selector */}
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

        {/* Done (chips) */}
        <View style={styles.btnWrapper}>
          <View style={styles.btnInner}>
            <TouchableOpacity style={styles.btn} onPress={handleDone}>
              <Text style={styles.btnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>

      {/* Input bar */}
      <View style={styles.inputBar}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Rice 1 cup, Chicken 100 g, Milk 200 ml"
          placeholderTextColor={C.muted}
          style={styles.input}
          onSubmitEditing={handleSend}
          returnKeyType="send"
        />
        <TouchableOpacity style={styles.iconBtn}>
          <Text>🎤</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.sendBtn} onPress={handleSend}>
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>

          </View>{/* flex:1 */}
        </KeyboardAvoidingView>

      </View>{/* outer */}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0B0F14",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  headerTitle: {
    color: C.text,
    fontSize: 20,
    fontWeight: "700",
  },
  cancel: {
    color: C.muted,
    fontSize: 15,
  },
  scroll: {
    padding: 20,
    paddingBottom: 12,
  },
  title: {
    color: C.text,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 14,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
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
  btnWrapper: {
    alignItems: "center",
    marginVertical: 6,
  },
  btnInner: {
    width: 260,
  },
  btn: {
    width: "100%",
    backgroundColor: C.accent,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    elevation: 2,
  },
  btnText: {
    color: "#000",
    fontWeight: "600",
    fontSize: 15,
  },
  inputBar: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 8,
    margin: 10,
    alignItems: "center",
  },
  input: {
    flex: 1,
    color: C.text,
    paddingVertical: 4,
    paddingHorizontal: 4,
    fontSize: 14,
  },
  iconBtn: {
    marginRight: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: C.surfaceAlt,
  },
  sendBtn: {
    backgroundColor: C.accent,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  sendText: {
    color: "#000",
    fontWeight: "600",
  },
});

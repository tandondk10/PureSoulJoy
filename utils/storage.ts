import AsyncStorage from "@react-native-async-storage/async-storage";

const USER_KEY = "user_id";

export const saveUser = async (userId: string | null) => {
    try {
        if (!userId) {
            await AsyncStorage.removeItem(USER_KEY);
        } else {
            await AsyncStorage.setItem(USER_KEY, userId);
        }
    } catch (e) {
        console.log("saveUser error:", e);
    }
};

export const loadUser = async () => {
    try {
        const user = await AsyncStorage.getItem(USER_KEY);
        console.log("LOADED USER:", user); // 🔥 keep this for now
        return user;
    } catch (e) {
        console.log("loadUser error:", e);
        return null;
    }
};

// Clear user (logout)
export const clearUser = async () => {
    try {
        await AsyncStorage.removeItem(USER_KEY);
    } catch (e) {
        console.log("Error clearing user", e);
    }
};
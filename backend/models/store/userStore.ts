import { create } from "zustand";

export const useUserStore = create((set) => ({
    user: null,

    setUser: (user) => set({ user }),

    updateGlucose: (glucose) =>
        set((state) => ({
            user: {
                ...state.user,
                conditions: {
                    ...state.user.conditions,
                    glucose,
                },
            },
        })),
}));
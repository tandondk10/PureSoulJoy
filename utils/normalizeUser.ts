export function getNormalizedUser(user: any) {
    if (!user) return null;

    return {
        user_id: user.user_id || user.id || user.name || "anonymous"
    };
}
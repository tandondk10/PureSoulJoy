import requests

USDA_API_KEY="GbRmN8qQZDoqGA1YReexDl6sRoCNLfM2X9DadsJI"

def extract_usda_nutrients(nutrients):
    def get_value(name):
        for n in nutrients:
            nutrient_name = (
                (n.get("nutrientName") or "")
                or (n.get("nutrient", {}).get("name") or "")
            ).lower()

            value = n.get("value") if "value" in n else n.get("amount", 0)

            if name in nutrient_name:
                return float(value or 0)

        return 0.0

    return {
        "carbs_g": get_value("carbohydrate"),
        "protein_g": get_value("protein"),
        "fat_g": get_value("lipid"),
        "sat_fat_g": get_value("saturated"),
        "fiber_g": get_value("fiber"),
        "calories": get_value("energy"),
    }


def call_usda(food):
    print("\n🔍 SEARCH:", food)

    r = requests.get(
        "https://api.nal.usda.gov/fdc/v1/foods/search",
        params={"api_key": USDA_API_KEY, "query": food, "pageSize": 10},
        timeout=5,
    )

    data = r.json()
    foods = data.get("foods", [])

    if not foods:
        print("[USDA_NO_RESULTS]", food)
        return None

    # 🔥 STEP 1: prefer high quality
    preferred = [
        f for f in foods
        if f.get("dataType") in ("SR Legacy", "Foundation")
    ]

    candidates = preferred if preferred else foods  # 🔥 fallback

    # 🔥 STEP 2: pick best nutrient-rich candidate
    best_food = None
    best_score = -1

    for f in candidates:
        score = len(f.get("foodNutrients", []))

        if score > best_score:
            best_score = score
            best_food = f

    if not best_food:
        print("[USDA_NO_GOOD_MATCH]", food)
        return None

    fdc_id = best_food["fdcId"]
    print("✅ FDC_ID:", fdc_id)

    r2 = requests.get(
        f"https://api.nal.usda.gov/fdc/v1/food/{fdc_id}",
        params={"api_key": USDA_API_KEY},
        timeout=5,
    )

    food_data = r2.json()
    nutrients = food_data.get("foodNutrients", [])

    print("🔬 RAW NUTRIENTS SAMPLE:")
    for n in nutrients[:5]:
        print(n)

    parsed = extract_usda_nutrients(nutrients)

    print("\n🔥 PARSED:")
    print(parsed)


if __name__ == "__main__":
    call_usda("black-eyed peas")
    
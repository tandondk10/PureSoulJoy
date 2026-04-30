import csv
import re
import requests
import os

SEED_FOOD_ITEMS = [
    {
        "name": "Pizza",
        "carbs_g": 30,
        "protein_g": 11,
        "fat_g": 10,
        "sat_fat_g": 5,
        "fiber_g": 2,
        "calories": 266,
    },
    {
        "name": "Rice",
        "carbs_g": 28,
        "protein_g": 2.7,
        "fat_g": 0.3,
        "sat_fat_g": 0.1,
        "fiber_g": 0.4,
        "calories": 130,
    },
    {
        "name": "Chicken",
        "carbs_g": 0,
        "protein_g": 27,
        "fat_g": 3.6,
        "sat_fat_g": 1,
        "fiber_g": 0,
        "calories": 165,
    },
    {
        "name": "Salad",
        "carbs_g": 3.5,
        "protein_g": 1.5,
        "fat_g": 0.2,
        "sat_fat_g": 0,
        "fiber_g": 2,
        "calories": 20,
    },
    {
        "name": "Burger",
        "carbs_g": 24,
        "protein_g": 17,
        "fat_g": 14,
        "sat_fat_g": 5,
        "fiber_g": 1,
        "calories": 295,
    },
    {
        "name": "Banana",
        "carbs_g": 23,
        "protein_g": 1.1,
        "fat_g": 0.3,
        "sat_fat_g": 0.1,
        "fiber_g": 2.6,
        "calories": 89,
    },
    {
        "name": "Apple",
        "carbs_g": 14,
        "protein_g": 0.3,
        "fat_g": 0.2,
        "sat_fat_g": 0,
        "fiber_g": 2.4,
        "calories": 52,
    },
    {
        "name": "Bread",
        "carbs_g": 13,
        "protein_g": 2.7,
        "fat_g": 1,
        "sat_fat_g": 0.2,
        "fiber_g": 0.6,
        "calories": 79,
    },
    {
        "name": "Egg",
        "carbs_g": 0.6,
        "protein_g": 6,
        "fat_g": 5,
        "sat_fat_g": 1.6,
        "fiber_g": 0,
        "calories": 68,
    },
    {
        "name": "Yogurt",
        "carbs_g": 3.6,
        "protein_g": 10,
        "fat_g": 0.4,
        "sat_fat_g": 0.1,
        "fiber_g": 0,
        "calories": 59,
    },
    {
        "name": "Pasta",
        "carbs_g": 25,
        "protein_g": 5,
        "fat_g": 1,
        "sat_fat_g": 0.2,
        "fiber_g": 1.8,
        "calories": 131,
    },
    {
        "name": "Oatmeal",
        "carbs_g": 27,
        "protein_g": 5,
        "fat_g": 3,
        "sat_fat_g": 0.5,
        "fiber_g": 4,
        "calories": 158,
    },
    {
        "name": "Butter",
        "carbs_g": 0,
        "protein_g": 0.1,
        "fat_g": 81,
        "sat_fat_g": 51,
        "fiber_g": 0,
        "calories": 717,
    },
    {
        "name": "Cheese",
        "carbs_g": 1.3,
        "protein_g": 25,
        "fat_g": 33,
        "sat_fat_g": 21,
        "fiber_g": 0,
        "calories": 402,
    },
    {
        "name": "Milk",
        "carbs_g": 4.8,
        "protein_g": 3.4,
        "fat_g": 3.3,
        "sat_fat_g": 1.9,
        "fiber_g": 0,
        "calories": 61,
    },
    {
        "name": "Salmon",
        "carbs_g": 0,
        "protein_g": 20,
        "fat_g": 13,
        "sat_fat_g": 3,
        "fiber_g": 0,
        "calories": 208,
    },
    {
        "name": "Broccoli",
        "carbs_g": 7,
        "protein_g": 2.8,
        "fat_g": 0.4,
        "sat_fat_g": 0,
        "fiber_g": 2.6,
        "calories": 34,
    },
    {
        "name": "Potato",
        "carbs_g": 17,
        "protein_g": 2,
        "fat_g": 0.1,
        "sat_fat_g": 0,
        "fiber_g": 2.2,
        "calories": 77,
    },
    {
        "name": "Almonds",
        "carbs_g": 22,
        "protein_g": 21,
        "fat_g": 49,
        "sat_fat_g": 3.7,
        "fiber_g": 12.5,
        "calories": 579,
    },
    {
        "name": "Orange",
        "carbs_g": 12,
        "protein_g": 0.9,
        "fat_g": 0.1,
        "sat_fat_g": 0,
        "fiber_g": 2.4,
        "calories": 47,
    },
]


def _parse_food_data(data: list) -> dict:
    food_data = {}
    for item in data:
        name = item["name"].strip().lower()
        food_data[name] = {
            "carbs_g": float(item.get("carbs_g", 0)),
            "protein_g": float(item.get("protein_g", 0)),
            "fat_g": float(item.get("fat_g", 0)),
            "sat_fat_g": float(item.get("sat_fat_g", 0)),
            "fiber_g": float(item.get("fiber_g", 0)),
            "calories": float(item.get("calories", 0)),
        }
    return food_data


def load_food_data(api_url: str) -> dict:
    response = requests.get(api_url)
    data = response.json()
    return _parse_food_data(data)


def build_food_calories(food_data: dict) -> dict:
    food_calories = {}
    for food, n in food_data.items():
        food_calories[food] = {
            "glucose": n["carbs_g"] * 4,
            "cholesterol": n["sat_fat_g"] * 9,
        }
    return food_calories


def detect_foods(query: str) -> list:
    q = query.lower()
    detected = []

    for food in FOOD_DATA.keys():
        base_name = food.split("(")[0].strip()  # remove "(cooked)", etc.

        if re.search(rf"\b{re.escape(base_name)}\b", q):
            detected.append(food)

    return detected


def score_domains(foods: list, multiplier: float = 1.0) -> dict:
    scores = {"glucose": 0.0, "cholesterol": 0.0, "lifestyle": 0.0}
    for food in foods:
        f = FOOD_DATA.get(food)
        if not f:
            continue
        carbs = f.get("carbs_g", 0)
        sat_fat = f.get("sat_fat_g", 0)
        scores["glucose"] += carbs * 4 * multiplier
        scores["cholesterol"] += sat_fat * 9 * multiplier
    return scores


DOMAIN_PRIORITY = ["glucose", "cholesterol", "lifestyle"]


def pick_domain(scores: dict) -> str:
    best_score = max(scores.values())
    winners = [d for d, v in scores.items() if v == best_score]
    if len(winners) == 1:
        return winners[0]
    for d in DOMAIN_PRIORITY:
        if d in winners:
            return d


def extract_grams(query: str) -> float:
    match = re.search(r"(\d+)\s*(g|grams)", query.lower())
    if match:
        return float(match.group(1))
    return 100.0


def compute_nutrition_summary(foods: list, multiplier: float = 1.0) -> dict:
    totals = {
        "carbs_g": 0.0,
        "protein_g": 0.0,
        "fat_g": 0.0,
        "sat_fat_g": 0.0,
        "fiber_g": 0.0,
        "soluble_fiber_g": 0.0,
    }
    for food in foods:
        f = FOOD_DATA.get(food)
        if not f:
            continue
        totals["carbs_g"] += f["carbs_g"] * multiplier
        totals["protein_g"] += f["protein_g"] * multiplier
        totals["fat_g"] += f["fat_g"] * multiplier
        totals["sat_fat_g"] += f["sat_fat_g"] * multiplier
        totals["fiber_g"] += f["fiber_g"] * multiplier
        totals["soluble_fiber_g"] += f.get("soluble_fiber_g", 0) * multiplier
    totals["insoluble_fiber_g"] = totals["fiber_g"] - totals["soluble_fiber_g"]
    return totals


def compute_meal_calories(foods: list, multiplier: float = 1.0) -> float:
    total = 0.0
    for food in foods:
        f = FOOD_DATA.get(food)
        if f:
            total += (
                f["carbs_g"] * 4 +
                f["protein_g"] * 4 +
                f["fat_g"] * 9
            ) * multiplier
    return total


UNKNOWN_FOODS = set()


def process_query(query: str) -> dict:
    foods = detect_foods(query)

    if not foods:
        UNKNOWN_FOODS.add(query.lower())
        return {
            "foods": [],
            "scores": {"glucose": 0, "cholesterol": 0, "lifestyle": 0},
            "domain": "unknown",
            "meal_calories": 0.0,
        }

    grams = extract_grams(query)
    multiplier = grams / 100.0 if len(foods) == 1 else 1.0

    scores = score_domains(foods, multiplier)
    domain = pick_domain(scores)
    calories = compute_meal_calories(foods, multiplier)
    nutrition = compute_nutrition_summary(foods, multiplier)
    return {
        "foods": foods,
        "scores": scores,
        "domain": domain,
        "meal_calories": calories,
        "nutrition": nutrition,
    }


def load_food_data_from_csv(file_path: str) -> dict:
    import csv

    food_data = {}

    with open(file_path, newline="") as csvfile:
        reader = csv.DictReader(csvfile)

        for row in reader:
            try:
                name = row["Name"].strip().lower()

                food_data[name] = {
                    "carbs_g": float(row.get("Carbs (g)", 0)),
                    "protein_g": float(row.get("Protein (g)", 0)),
                    "fat_g": float(row.get("Total Fat (g)", 0)),
                    "sat_fat_g": float(row.get("Saturated Fat (g)", 0)),
                    "fiber_g": float(row.get("Total Fiber (g)", 0)),
                    "soluble_fiber_g": float(row.get("Soluble Fiber (g)", 0)),
                    "calories": float(row.get("Calories (kcal)", 0)),
                }

            except Exception as e:
                print(f"⚠️ Skipping row due to error: {e}")

    return food_data


BASE_DIR = os.path.dirname(os.path.abspath(__file__))

csv_path = os.path.join(BASE_DIR, "data", "food_items.csv")

print("📂 CSV PATH:", csv_path)

try:
    FOOD_DATA = load_food_data_from_csv(csv_path)
    print(f"✅ CSV LOADED: {len(FOOD_DATA)} items")
except Exception as e:
    print(f"❌ CSV LOAD FAILED: {e}")
    FOOD_DATA = _parse_food_data(SEED_FOOD_ITEMS)

FOOD_CALORIES = build_food_calories(FOOD_DATA)

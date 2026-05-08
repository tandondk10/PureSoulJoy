import requests
from services.food_db_updater import save_food_to_csv

USDA_API_KEY="GbRmN8qQZDoqGA1YReexDl6sRoCNLfM2X9DadsJI"

BASE_URL = "https://api.nal.usda.gov/fdc/v1"

USDA_SYNONYMS = {
    "black eyed peas": ["cowpeas", "blackeye beans"],
    "kidney beans": ["red kidney beans"],
}
import uuid
import inspect
from functools import wraps

def trace(func):
    @wraps(func)
    async def async_wrapper(*args, **kwargs):
        trace_id = kwargs.get("trace_id") or str(uuid.uuid4())[:8]

        print(f"\n🔍 [TRACE {trace_id}] ENTER {func.__name__}")
        print(f"[TRACE {trace_id}] INPUT:", args, kwargs)

        result = await func(*args, **kwargs)

        print(f"✅ [TRACE {trace_id}] EXIT {func.__name__}")
        print(f"[TRACE {trace_id}] OUTPUT:", str(result)[:300])

        return result

    @wraps(func)
    def sync_wrapper(*args, **kwargs):
        trace_id = kwargs.get("trace_id") or str(uuid.uuid4())[:8]

        print(f"\n🔍 [TRACE {trace_id}] ENTER {func.__name__}")
        print(f"[TRACE {trace_id}] INPUT:", args, kwargs)

        result = func(*args, **kwargs)

        print(f"✅ [TRACE {trace_id}] EXIT {func.__name__}")
        print(f"[TRACE {trace_id}] OUTPUT:", str(result)[:300])

        return result

    # 👇 KEY LINE
    return async_wrapper if inspect.iscoroutinefunction(func) else sync_wrapper

@trace
def call_usda(food: str, trace_id=None):
    try:
        resolved = resolve_usda(food, trace_id)

        if not resolved:
            print(f"[USDA_WRAPPER][MISS] {food}")
            return None

        nutrients = resolved.get("nutrients", [])

        # 🔥 THIS is the correct conversion
        parsed = extract_usda_nutrients(nutrients)

        print(f"[USDA_WRAPPER][HIT] {food} → FDC_ID={resolved.get('fdc_id')}")

        return {
            **parsed,
            "_source": "usda_new",
            "fdc_id": resolved.get("fdc_id"),
        }

    except Exception as e:
        print(f"[USDA_WRAPPER][ERROR] {food} → {e}")
        return None
        
def extract_usda_nutrients(nutrients):
    def get_value(name):
        for n in nutrients:
            if not isinstance(n, dict):   # 🔥 FIX
                continue

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


def search_usda(query, trace_id=None):
    try:
        print(f"[USDA][SEARCH] 🔍 {query}")

        r = requests.get(
            "https://api.nal.usda.gov/fdc/v1/foods/search",
            params={
                "api_key": USDA_API_KEY,
                "query": query,
                "pageSize": 5,
            },
            timeout=5,
        )

        data = r.json()

        foods = data.get("foods", [])
        if not foods:
            print(f"[USDA][NO_RESULTS] {query}")
            return None

        # ✅ iterate list (FIX)
        best_food = None
        best_score = -1

        for f in foods:
            if not isinstance(f, dict):
                continue

            score = len(f.get("foodNutrients", []))

            if score > best_score:
                best_score = score
                best_food = f

        if not best_food:
            return None

        fdc_id = best_food.get("fdcId")

        print(f"[USDA][SELECTED] FDC_ID={fdc_id}")

        # ✅ fetch details
        r2 = requests.get(
            f"https://api.nal.usda.gov/fdc/v1/food/{fdc_id}",
            params={"api_key": USDA_API_KEY},
            timeout=5,
        )

        food_data = r2.json()

        nutrients = food_data.get("foodNutrients", [])

        # ✅ FIX: return structured object
        return {
            "fdc_id": fdc_id,
            "nutrients": nutrients
        }

    except Exception as e:
        print(f"[USDA][ERROR] {query} → {e}")
        return None

def get_usda_food_details(fdc_id, trace_id=None):
    r = requests.get(
        f"{BASE_URL}/food/{fdc_id}",
        params={"api_key": USDA_API_KEY},
        timeout=5,
    )

    food_data = r.json()

    nutrients = food_data.get("foodNutrients", [])

    parsed = extract_usda_nutrients(nutrients)
    save_food_to_csv(food_data, parsed)

    print(f"[USDA][DETAILS][{trace_id}] {parsed}")

    return {
        "fdc_id": fdc_id,
        "description": food_data.get("description"),
        "nutrients": parsed,
    }
    
def resolve_usda(food: str, trace_id=None):
    query = clean_usda_query(food)

    # 🔥 LIMIT attempts (critical)
    for candidate in expand_query(query)[:3]:

        if trace_id:
            print(f"[USDA][TRY][{trace_id}] {candidate}")
        else:
            print(f"[USDA][TRY] {candidate}")

        result = search_usda(candidate, trace_id)

        if result:
            return result

    print(f"[USDA][FAILED_ALL] {food}")
    return None
    
def clean_usda_query(food: str) -> str:
    return (
        food.lower()
        .replace("-", " ")
        .replace("(cooked)", "")
        .replace("(raw)", "")
        .strip()
    )

def expand_query(query: str):
    q = query.lower()

    if q in USDA_SYNONYMS:
        return [q] + USDA_SYNONYMS[q]

    return [q]   
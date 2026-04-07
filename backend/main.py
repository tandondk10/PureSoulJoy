from fastapi import FastAPI, Request
import json

app = FastAPI()

print("🚨 CLEAN BACKEND RUNNING")

@app.post("/query")
async def handle_query(request: Request):
    print("🔥 HANDLER HIT")

    body = await request.body()
    print("RAW:", body)

    data = json.loads(body.decode("utf-8"))
    query = (data.get("query") or "").strip().lower()

    return {
        "status": "success",
        "message": """## Likely Cause
    High sodium intake or low movement may be contributing.

    ## What To Do
    Drink water and take a 10 to 15 minute walk after your meal.

    ## Next Step
    Keep dinner lower in salt and heavier in protein and vegetables."""
    }
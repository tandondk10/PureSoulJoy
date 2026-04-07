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
        "message": f"Received: {query}"
    }

import os
import httpx
from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

app = FastAPI(title="Jetson AI Workspace")

class ChatRequest(BaseModel):
    provider: str
    model: str
    message: str

@app.get("/api/models")
async def models():
    result = []

    if os.getenv("GEMINI_API_KEY"):
        result.append({
            "provider": "gemini",
            "model": os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
        })

    if os.getenv("OPENAI_API_KEY"):
        result.append({
            "provider": "openai",
            "model": os.getenv("OPENAI_MODEL", "gpt-5.5")
        })

    try:
        async with httpx.AsyncClient(timeout=3) as client:
            r = await client.get(
                os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
                + "/api/tags"
            )
            r.raise_for_status()
            for m in r.json().get("models", []):
                result.append({
                    "provider": "ollama",
                    "model": m["name"]
                })
    except (httpx.HTTPError, ValueError, KeyError):
        pass

    return {"models": result}


@app.post("/api/chat")
async def chat(req: ChatRequest):
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            if req.provider == "gemini":
                key = os.getenv("GEMINI_API_KEY")
                if not key:
                    raise HTTPException(400, "Gemini key missing")
                if req.model != os.getenv("GEMINI_MODEL", "gemini-2.5-flash"):
                    raise HTTPException(400, "Model not configured")

                r = await client.post(
                    "https://generativelanguage.googleapis.com/v1beta/"
                    f"models/{req.model}:generateContent",
                    headers={"x-goog-api-key": key},
                    json={"contents": [{"parts": [{"text": req.message}]}]}
                )
                r.raise_for_status()
                parts = r.json()["candidates"][0]["content"]["parts"]
                answer = "".join(p.get("text", "") for p in parts)

            elif req.provider == "openai":
                key = os.getenv("OPENAI_API_KEY")
                if not key:
                    raise HTTPException(400, "OpenAI key missing")
                if req.model != os.getenv("OPENAI_MODEL", "gpt-5.5"):
                    raise HTTPException(400, "Model not configured")

                r = await client.post(
                    "https://api.openai.com/v1/responses",
                    headers={"Authorization": f"Bearer {key}"},
                    json={"model": req.model, "input": req.message}
                )
                r.raise_for_status()
                output = r.json().get("output", [])
                answer = "".join(
                    c.get("text", "")
                    for item in output
                    for c in item.get("content", [])
                    if c.get("type") == "output_text"
                )

            elif req.provider == "ollama":
                base = os.getenv(
                    "OLLAMA_URL", "http://127.0.0.1:11434"
                )
                tags = await client.get(base + "/api/tags")
                tags.raise_for_status()
                installed = {
                    m["name"] for m in tags.json().get("models", [])
                }
                if req.model not in installed:
                    raise HTTPException(400, "Model not installed")

                r = await client.post(
                    base + "/api/chat",
                    json={
                        "model": req.model,
                        "messages": [
                            {"role": "user", "content": req.message}
                        ],
                        "stream": False
                    }
                )
                r.raise_for_status()
                answer = r.json()["message"]["content"]

            else:
                raise HTTPException(400, "Unknown provider")

        return {
            "provider": req.provider,
            "model": req.model,
            "answer": answer
        }

    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Provider returned HTTP {e.response.status_code}"
        )
    except httpx.RequestError:
        raise HTTPException(502, "Provider connection failed")
    except (KeyError, IndexError, TypeError):
        raise HTTPException(502, "Unexpected provider response")

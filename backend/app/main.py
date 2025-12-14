from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import github, eval

app = FastAPI(title="Nanite Eval API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(github.router, prefix="/api")
app.include_router(eval.router, prefix="/api")


@app.get("/health")
async def health_check():
    return {"status": "ok"}


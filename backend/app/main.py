from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.errors import register_error_handlers
from app.routers import auth, changes, hosted_zones, records
from app.seed import init_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="Route 53 Clone API",
    version="1.0.0",
    description="REST API backing the AWS Route 53 console clone. "
    "Authenticate via POST /api/auth/login and send the token as `Authorization: Bearer <token>`.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_error_handlers(app)
app.include_router(auth.router)
app.include_router(hosted_zones.router)
app.include_router(records.router)
app.include_router(changes.router)


@app.get("/api/health", tags=["meta"])
def health():
    return {"status": "ok"}

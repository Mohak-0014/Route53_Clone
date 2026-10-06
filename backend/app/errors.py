"""Uniform error responses: {"code": "...", "message": "..."}.

Codes follow Route 53's API error names where one exists
(NoSuchHostedZone, HostedZoneNotEmpty, InvalidChangeBatch, ...).
"""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm.exc import StaleDataError

logger = logging.getLogger("route53")


class AppError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def not_found(code: str, message: str) -> AppError:
    return AppError(404, code, message)


def bad_request(code: str, message: str) -> AppError:
    return AppError(400, code, message)


def conflict(code: str, message: str) -> AppError:
    return AppError(409, code, message)


def concurrent_modification() -> AppError:
    return conflict(
        "ConcurrentModification",
        "This record was changed after you opened it. Reload to see the latest values, then try again.",
    )


def _format_validation_error(err: dict) -> str:
    loc = [str(p) for p in err.get("loc", []) if p not in ("body", "query", "path")]
    field = ".".join(loc)
    msg = err.get("msg", "Invalid value")
    msg = msg.removeprefix("Value error, ")
    return f"{field}: {msg}" if field else msg


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_req: Request, exc: AppError):
        return JSONResponse(
            status_code=exc.status_code, content={"code": exc.code, "message": exc.message}
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_req: Request, exc: RequestValidationError):
        errors = exc.errors()
        message = _format_validation_error(errors[0]) if errors else "Invalid request"
        return JSONResponse(
            status_code=422,
            content={
                "code": "InvalidInput",
                "message": message,
                "errors": [_format_validation_error(e) for e in errors],
            },
        )

    @app.exception_handler(IntegrityError)
    async def _integrity_error(_req: Request, exc: IntegrityError):
        logger.warning("Integrity error: %s", exc)
        return JSONResponse(
            status_code=409,
            content={"code": "Conflict", "message": "The request conflicts with existing data."},
        )

    @app.exception_handler(StaleDataError)
    async def _stale(_req: Request, _exc: StaleDataError):
        # Another request updated the row between our read and our write.
        err = concurrent_modification()
        return JSONResponse(status_code=err.status_code, content={"code": err.code, "message": err.message})

    @app.exception_handler(SQLAlchemyError)
    async def _db_error(_req: Request, exc: SQLAlchemyError):
        logger.exception("Database error", exc_info=exc)
        return JSONResponse(
            status_code=500,
            content={"code": "InternalError", "message": "A database error occurred."},
        )

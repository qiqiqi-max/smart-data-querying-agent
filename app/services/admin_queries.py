"""Filtered pagination over history summaries, never result blobs."""

from sqlalchemy import func, select

from app.models.query_history import QueryHistoryMySQL as History


async def list_queries(session, page=1, page_size=20, q="", status=""):
    conditions = []
    if q:
        conditions.append(History.query.contains(q, autoescape=True))
    if status:
        conditions.append(History.status == status)
    total = (
        await session.execute(
            select(func.count()).select_from(History).where(*conditions)
        )
    ).scalar_one()
    result = await session.execute(
        select(
            History.id,
            History.query,
            History.status,
            History.summary,
            History.row_count,
            History.error,
            History.created_at,
            History.updated_at,
        )
        .where(*conditions)
        .order_by(History.updated_at.desc(), History.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return {
        "items": [dict(row) for row in result.mappings().all()],
        "total": total,
        "page": page,
        "page_size": page_size,
    }

"""Bounded, server-owned clarification context and readable historical questions."""

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class ClarificationError(ValueError):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


class ClarificationTurn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    questions: list[str] = Field(max_length=3)
    answer: str = Field(min_length=1, max_length=500)


class ClarificationContext(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    original_query: str = Field(min_length=1, max_length=500)
    turns: list[ClarificationTurn] = Field(default_factory=list, max_length=5)


def continue_clarification(history, answer: str) -> dict:
    if history is None:
        raise ClarificationError("找不到待补充的查询记录，请新建分析。", 404)
    response = getattr(history, "response", None)
    if (
        history.status != "clarify"
        or not isinstance(response, dict)
        or response.get("status") != "clarify"
    ):
        raise ClarificationError("这条记录不处于待补充状态，请新建分析。", 409)
    try:
        context = ClarificationContext.model_validate(
            response.get("clarification_context")
        )
        questions = response["questions"]
        if (
            not isinstance(questions, list)
            or not questions
            or any(not isinstance(item, str) for item in questions)
        ):
            raise ValueError("追问不存在")
    except (ValidationError, KeyError, ValueError) as exc:
        raise ClarificationError(
            "这条记录的追问上下文不完整，请新建分析并写明问题。", 409
        ) from exc
    if len(context.turns) >= 5:
        raise ClarificationError("本次分析已达到 5 轮补充，请新建分析并写明完整问题。")
    try:
        turn = ClarificationTurn(questions=questions, answer=answer.strip())
    except ValidationError as exc:
        raise ClarificationError("补充信息必须为 1 到 500 字。") from exc
    context.turns.append(turn)
    return context.model_dump()


def historical_question(context: dict) -> str:
    value = ClarificationContext.model_validate(context)
    lines = [value.original_query]
    for number, turn in enumerate(value.turns, 1):
        lines.append(f"追问 {number}：" + "；".join(turn.questions))
        lines.append(f"补充 {number}：{turn.answer}")
    return "\n".join(lines)

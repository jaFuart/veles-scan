from __future__ import annotations

import hashlib
import json
import logging
import uuid
from dataclasses import dataclass

from openai import OpenAI


log = logging.getLogger("api.pricing")


MODEL_SURCHARGE_RUB: dict[str, int] = {
    "nano": 0,
    "mini": 120,
    "full": 390,
}


PRICING_SYSTEM_PROMPT = """
Ты — сервис умного ценообразования B2B-поиска компаний.

Твоя задача: вернуть обоснованную и стабильную цену проекта в рублях.

Обязательные правила:
1. Базовая фиксированная цена (base_price_rub) всегда включается в расчёт и не может быть проигнорирована.
2. Цена зависит только от факторов сложности: ширина ниши (okved), количество выходных полей, сложность фильтров, ожидаемая трудоёмкость.
3. Цена должна быть стабильной: микроправки текста не должны давать резкие скачки.
4. Учитывай previous_price_rub и previous_prompt как контекст преемственности.
5. Не возвращай цену ниже base_price_rub.
6. Не возвращай отрицательные надбавки.
7. В пользовательском объяснении запрещено упоминать previous_price_rub, previous_prompt и любые предыдущие цены.
8. Пункты reason_details должны быть краткими и в формате "Критерий: +N ₽".

Формат ответа только JSON:
{
    "estimated_price_rub": 1720,
    "reason_short": "Краткое объяснение цены без истории",
    "reason_details": [
        "База: +1000 ₽",
        "Сложность формата: +190 ₽"
    ]
}

Требования к полям:
- estimated_price_rub: целое число в рублях.
- reason_short: 1 короткое предложение.
- reason_details: 1-5 пунктов, каждый как отдельная строка.
""".strip()


@dataclass(frozen=True)
class PricingContext:
    base_price_rub: int
    response_format: str | None
    resolved_output_fields: list[dict[str, str]]
    resolved_data_filters: list[dict]
    resolved_okved_codes: list[str]
    openai_model: str
    previous_price_rub: int | None = None
    previous_prompt: str | None = None
    previous_reasoning_short: str | None = None
    previous_reasoning_details: list[str] | None = None
    min_delta_rub: int = 25


@dataclass(frozen=True)
class PricingEstimate:
    estimated_price_rub: int
    pricing_source: str
    pricing_model: str | None
    pricing_reason_short: str
    pricing_reason_details: list[str]
    pricing_prompt: str
    pricing_prompt_hash: str
    input_signature: str


@dataclass(frozen=True)
class PricingComponents:
    base: int
    complexity_surcharge: int
    breadth_surcharge: int
    filters_surcharge: int
    geography_surcharge: int
    model_surcharge: int
    model_tier: str

    @property
    def deterministic_total(self) -> int:
        return (
            self.base
            + self.complexity_surcharge
            + self.breadth_surcharge
            + self.filters_surcharge
            + self.geography_surcharge
            + self.model_surcharge
        )


def _detect_model_tier(openai_model: str) -> str:
    model = (openai_model or "").strip().lower()
    if not model:
        return "mini"
    if "nano" in model:
        return "nano"
    if "mini" in model:
        return "mini"
    return "full"


def _count_output_fields(response_format: str | None, resolved_output_fields: list[dict[str, str]]) -> int:
    from_resolved = sum(1 for field in resolved_output_fields if str(field.get("key", "")).strip() or str(field.get("label", "")).strip())
    if from_resolved > 0:
        return from_resolved
    return len([item.strip() for item in (response_format or "").split(",") if item.strip()])


def _count_filter_values(resolved_data_filters: list[dict]) -> int:
    total = 0
    for item in resolved_data_filters or []:
        value = item.get("value") if isinstance(item, dict) else None
        if isinstance(value, list):
            total += len([entry for entry in value if str(entry).strip()])
            continue
        if isinstance(value, str):
            parts = [part.strip() for part in value.split(",") if part.strip()]
            total += len(parts) if parts else 1
            continue
        if value is not None:
            total += 1
    return total


def _compute_pricing_components(context: PricingContext) -> PricingComponents:
    base = max(0, int(context.base_price_rub or 0))
    output_fields_count = _count_output_fields(context.response_format, context.resolved_output_fields)
    okved_count = max(0, len(context.resolved_okved_codes or []))
    filters_count = max(0, len(context.resolved_data_filters or []))
    filters_values_count = _count_filter_values(context.resolved_data_filters or [])

    complexity_surcharge = 0
    if output_fields_count > 40:
        complexity_surcharge = 390
    elif output_fields_count > 25:
        complexity_surcharge = 190

    breadth_surcharge = 0
    if okved_count > 20:
        breadth_surcharge = 160
    elif okved_count > 10:
        breadth_surcharge = 80

    filters_surcharge = 60 if filters_count >= 3 else 0
    geography_surcharge = 0
    if filters_values_count >= 5:
        geography_surcharge = 90
    elif filters_values_count >= 2:
        geography_surcharge = 40

    model_tier = _detect_model_tier(context.openai_model)
    model_surcharge = MODEL_SURCHARGE_RUB.get(model_tier, MODEL_SURCHARGE_RUB["mini"])
    return PricingComponents(
        base=base,
        complexity_surcharge=complexity_surcharge,
        breadth_surcharge=breadth_surcharge,
        filters_surcharge=filters_surcharge,
        geography_surcharge=geography_surcharge,
        model_surcharge=model_surcharge,
        model_tier=model_tier,
    )


def _build_public_reason_details(components: PricingComponents, estimated_price_rub: int) -> list[str]:
    details: list[str] = [f"База: +{components.base} ₽"]
    if components.complexity_surcharge > 0:
        details.append(f"Сложность формата: +{components.complexity_surcharge} ₽")
    if components.breadth_surcharge > 0:
        details.append(f"Ширина ниши (ОКВЭД): +{components.breadth_surcharge} ₽")
    if components.filters_surcharge > 0:
        details.append(f"Сложность фильтров: +{components.filters_surcharge} ₽")
    if components.geography_surcharge > 0:
        details.append(f"Ширина гео/условий: +{components.geography_surcharge} ₽")
    if components.model_surcharge > 0:
        details.append(f"Модель ({components.model_tier}): +{components.model_surcharge} ₽")

    ai_adjustment = int(estimated_price_rub) - int(components.deterministic_total)
    if ai_adjustment > 0:
        details.append(f"Корректировка ИИ: +{ai_adjustment} ₽")
    return details[:6]


def _extract_json_object(content: str) -> dict | None:
    if not content:
        return None
    content = content.strip()
    try:
        payload = json.loads(content)
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def _build_input_signature(context: PricingContext) -> str:
    payload = {
        "base_price_rub": max(0, int(context.base_price_rub or 0)),
        "response_format": (context.response_format or "").strip(),
        "resolved_output_fields": context.resolved_output_fields or [],
        "resolved_data_filters": context.resolved_data_filters or [],
        "resolved_okved_codes": sorted(context.resolved_okved_codes or []),
        "model": context.openai_model,
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _build_user_prompt(context: PricingContext) -> str:
    payload = {
        "base_price_rub": max(0, int(context.base_price_rub or 0)),
        "response_format": (context.response_format or "").strip(),
        "resolved_output_fields": context.resolved_output_fields or [],
        "resolved_data_filters": context.resolved_data_filters or [],
        "resolved_okved_codes": sorted(context.resolved_okved_codes or []),
        "previous_price_rub": context.previous_price_rub,
        "previous_prompt": (context.previous_prompt or "").strip(),
        "previous_reasoning_short": (context.previous_reasoning_short or "").strip(),
        "previous_reasoning_details": context.previous_reasoning_details or [],
        "min_delta_rub": max(0, int(context.min_delta_rub or 0)),
    }
    return (
        "Входные данные для расчёта цены:\n"
        + json.dumps(payload, ensure_ascii=False, indent=2)
    )


def _heuristic_estimate(context: PricingContext) -> PricingEstimate:
    components = _compute_pricing_components(context)
    base = components.base
    raw_estimated = components.deterministic_total
    # Only apply stabilization if we have a previous price from the database
    previous_price = context.previous_price_rub
    min_delta = max(0, int(context.min_delta_rub or 0))
    if previous_price is not None and abs(raw_estimated - previous_price) < min_delta:
        estimated = previous_price
    else:
        estimated = raw_estimated

    details = _build_public_reason_details(components, max(base, int(estimated)))

    user_prompt = _build_user_prompt(context)
    return PricingEstimate(
        estimated_price_rub=max(base, int(estimated)),
        pricing_source=f"pricing_service:fallback:{components.model_tier}",
        pricing_model=context.openai_model,
        pricing_reason_short="Стоимость рассчитана по фиксированным критериям сложности.",
        pricing_reason_details=details,
        pricing_prompt=user_prompt,
        pricing_prompt_hash=hashlib.sha256(user_prompt.encode("utf-8")).hexdigest(),
        input_signature=_build_input_signature(context),
    )


def estimate_project_price(context: PricingContext) -> PricingEstimate:
    request_id = uuid.uuid4().hex[:12]
    heuristic = _heuristic_estimate(context)
    components = _compute_pricing_components(context)
    input_signature = _build_input_signature(context)
    log.info(
        "[pricing:%s] Start price estimation",
        request_id,
        extra={
            "request_id": request_id,
            "pricing_input_signature": input_signature,
            "openai_model": context.openai_model,
            "base_price_rub": context.base_price_rub,
            "resolved_okved_count": len(context.resolved_okved_codes or []),
            "resolved_output_fields_count": len(context.resolved_output_fields or []),
            "resolved_data_filters_count": len(context.resolved_data_filters or []),
            "previous_price_rub": context.previous_price_rub,
            "min_delta_rub": context.min_delta_rub,
        },
    )
    if not context.openai_model:
        log.info(
            "[pricing:%s] Selected fallback variant: openai_model is empty",
            request_id,
            extra={
                "request_id": request_id,
                "selected_variant": "heuristic_fallback_no_model",
                "estimated_price_rub": heuristic.estimated_price_rub,
                "pricing_source": heuristic.pricing_source,
            },
        )
        return heuristic
    # No API key in contour: keep deterministic fallback and explicit source.
    from services.shared.settings import SETTINGS

    if not SETTINGS.openai_api_key:
        log.info(
            "[pricing:%s] Selected fallback variant: OPENAI_API_KEY is missing",
            request_id,
            extra={
                "request_id": request_id,
                "selected_variant": "heuristic_fallback_no_api_key",
                "estimated_price_rub": heuristic.estimated_price_rub,
                "pricing_source": heuristic.pricing_source,
            },
        )
        return heuristic

    user_prompt = _build_user_prompt(context)
    prompt_hash = hashlib.sha256(user_prompt.encode("utf-8")).hexdigest()
    log.info(
        "[pricing:%s] Sending OpenAI pricing request",
        request_id,
        extra={
            "request_id": request_id,
            "openai_model": context.openai_model,
            "pricing_prompt_hash": prompt_hash,
            "pricing_prompt": user_prompt,
            "heuristic_price_rub": heuristic.estimated_price_rub,
            "deterministic_total_rub": components.deterministic_total,
        },
    )
    try:
        client = OpenAI(api_key=SETTINGS.openai_api_key)
        response = client.chat.completions.create(
            model=context.openai_model,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": PRICING_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            timeout=45,
        )
        raw_content = response.choices[0].message.content or ""
        log.info(
            "[pricing:%s] Received OpenAI pricing response",
            request_id,
            extra={
                "request_id": request_id,
                "openai_response_content": raw_content,
            },
        )
        payload = _extract_json_object(raw_content)
        if not payload:
            log.warning(
                "[pricing:%s] OpenAI response JSON parsing failed; selected heuristic fallback",
                request_id,
                extra={
                    "request_id": request_id,
                    "selected_variant": "heuristic_fallback_invalid_openai_payload",
                    "estimated_price_rub": heuristic.estimated_price_rub,
                    "pricing_source": heuristic.pricing_source,
                },
            )
            return heuristic

        raw_estimated = int(payload.get("estimated_price_rub", heuristic.estimated_price_rub))
        base = max(0, int(context.base_price_rub or 0))
        # Guardrail: AI estimate cannot be below deterministic criteria-based estimate.
        deterministic_floor = max(base, int(heuristic.estimated_price_rub))
        ai_candidate = max(base, int(raw_estimated))
        guarded_estimated = max(ai_candidate, deterministic_floor)

        # Only apply stabilization if we have a previous price from the database
        # (i.e., not on the first calculation when previous_price_rub is None)
        previous_price = context.previous_price_rub
        min_delta = max(0, int(context.min_delta_rub or 0))
        stabilized_estimated = guarded_estimated
        if previous_price is not None and abs(guarded_estimated - previous_price) < min_delta:
            stabilized_estimated = previous_price

        reason_short = "Стоимость рассчитана по фиксированным критериям сложности."
        reason_details = _build_public_reason_details(components, stabilized_estimated)

        log.info(
            "[pricing:%s] Selected OpenAI variant for pricing",
            request_id,
            extra={
                "request_id": request_id,
                "selected_variant": "openai",
                "openai_raw_estimated_rub": raw_estimated,
                "ai_candidate_rub": ai_candidate,
                "deterministic_floor_rub": deterministic_floor,
                "guarded_estimated_rub": guarded_estimated,
                "stabilized_estimated_rub": stabilized_estimated,
                "previous_price_rub": previous_price,
                "min_delta_rub": min_delta,
                "pricing_source": "pricing_service:openai",
            },
        )

        return PricingEstimate(
            estimated_price_rub=stabilized_estimated,
            pricing_source="pricing_service:openai",
            pricing_model=context.openai_model,
            pricing_reason_short=reason_short,
            pricing_reason_details=reason_details,
            pricing_prompt=user_prompt,
            pricing_prompt_hash=prompt_hash,
            input_signature=input_signature,
        )
    except Exception:
        log.exception(
            "[pricing:%s] OpenAI pricing request failed; selected heuristic fallback",
            request_id,
            extra={
                "request_id": request_id,
                "selected_variant": "heuristic_fallback_openai_exception",
                "estimated_price_rub": heuristic.estimated_price_rub,
                "pricing_source": heuristic.pricing_source,
            },
        )
        return heuristic


def estimate_project_price_rub(context: PricingContext) -> tuple[int, str]:
    estimate = estimate_project_price(context)
    return estimate.estimated_price_rub, estimate.pricing_source

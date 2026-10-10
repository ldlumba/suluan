"""Score a saved query-vector/distance artifact without provider calls."""

from __future__ import annotations

import argparse
import json
import pathlib
import unicodedata

from semantic_scoring import abstention_reason, reciprocal_rank_fusion, score_records


def normalized_title(value):
    """Compare labels by title identity, not capitalization or whitespace."""
    normalized = unicodedata.normalize("NFKC", value or "").casefold()
    return " ".join(normalized.split())


def evaluate(
    queries,
    artifact,
    *,
    strategy,
    max_score,
    min_margin,
    keyword_artifact=None,
    length_penalty=0.02,
):
    by_id = {item["id"]: item for item in artifact.get("vectors", [])}
    keyword_by_id = {
        item["id"]: item.get("items", []) for item in (keyword_artifact or [])
    }
    rows = []
    for probe in queries:
        saved = by_id.get(probe["id"])
        if not saved:
            raise ValueError(f"missing saved vector for {probe['id']}")
        ranked = score_records(
            saved.get("chunkDistances", {}),
            strategy=strategy,
            penalty=length_penalty,
        )
        reason = abstention_reason(
            ranked, max_score=max_score, min_margin=min_margin
        )
        keyword_items = keyword_by_id.get(probe["id"], [])
        title_to_ids = {}
        for item in [*saved.get("rankedItems", []), *keyword_items]:
            title_to_ids.setdefault(normalized_title(item.get("title")), []).append(
                item.get("id")
            )
        expected_titles = probe.get("expectedTitles")
        if expected_titles is None:
            expected_titles = [probe["expectedTitle"]] if probe.get("expectedTitle") else []
        expected_ids = [
            title_to_ids.get(normalized_title(title), []) for title in expected_titles
        ]
        expected_ranks = [
            min(
                (
                    rank
                    for rank, item in enumerate(ranked, 1)
                    if item.record_id in expected_id_set
                ),
                default=None,
            )
            for expected_id_set in expected_ids
        ]
        expected_rank = expected_ranks[0] if expected_ranks else None
        row = {
            "id": probe["id"],
            "kind": probe["kind"],
            "abstention": reason,
            "topRecordId": ranked[0].record_id if ranked and not reason else None,
            "topScore": ranked[0].score if ranked else None,
            "expectedRank": expected_rank,
            "expectedRanks": expected_ranks,
            "expectedAllFound": bool(expected_ranks)
            and reason is None
            and all(rank is not None for rank in expected_ranks),
            "rawHitAt1": any(rank == 1 for rank in expected_ranks),
            "hitAt1": reason is None and any(rank == 1 for rank in expected_ranks),
        }
        if keyword_artifact is not None:
            keyword_ids = [item.get("id") for item in keyword_items]
            hybrid_ids = reciprocal_rank_fusion(
                [[item.record_id for item in ranked], keyword_ids]
            )
            expected_id_set = {record_id for ids in expected_ids for record_id in ids}
            row["keywordRank"] = next(
                (
                    rank
                    for rank, record_id in enumerate(keyword_ids, 1)
                    if record_id in expected_id_set
                ),
                None,
            )
            row["hybridRank"] = next(
                (
                    rank
                    for rank, record_id in enumerate(hybrid_ids, 1)
                    if record_id in expected_id_set
                ),
                None,
            )
        rows.append(row)
    positives = [row for row in rows if row["kind"] != "clean_negative"]
    negatives = [row for row in rows if row["kind"] == "clean_negative"]
    by_kind = {}
    for kind in sorted({row["kind"] for row in rows}):
        subset = [row for row in rows if row["kind"] == kind]
        by_kind[kind] = {
            "queries": len(subset),
            "hitAt1": sum(row["hitAt1"] for row in subset) / len(subset),
            "allExpectedFound": sum(row["expectedAllFound"] for row in subset) / len(subset),
            "abstained": sum(row["abstention"] is not None for row in subset) / len(subset),
        }
    report = {
        "strategy": strategy,
        "maxScore": max_score,
        "minMargin": min_margin,
        "lengthPenalty": length_penalty,
        "positiveHitAt1": sum(row["hitAt1"] for row in positives)
        / len(positives)
        if positives
        else None,
        "negativeAbstention": sum(row["abstention"] is not None for row in negatives)
        / len(negatives)
        if negatives
        else None,
        "byKind": by_kind,
        "rows": rows,
    }
    if keyword_artifact is not None:
        report["keywordHitAt1"] = sum(
            row.get("keywordRank") == 1 for row in positives
        ) / len(positives) if positives else None
        report["hybridHitAt1"] = sum(
            row.get("hybridRank") == 1 for row in positives
        ) / len(positives) if positives else None
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("queries", type=pathlib.Path)
    parser.add_argument("artifact", type=pathlib.Path)
    parser.add_argument("--strategy", default="top_k_mean")
    parser.add_argument("--max-score", type=float, required=True)
    parser.add_argument("--min-margin", type=float)
    parser.add_argument(
        "--length-penalty",
        type=float,
        default=0.02,
        help="Penalty used by log_length_penalized_min (default: 0.02).",
    )
    parser.add_argument(
        "--keyword-artifact",
        type=pathlib.Path,
        help="Optional per-query keyword ranking artifact for offline RRF comparison.",
    )
    args = parser.parse_args()
    queries = json.loads(args.queries.read_text(encoding="utf-8"))
    artifact = json.loads(args.artifact.read_text(encoding="utf-8"))
    keyword_artifact = (
        json.loads(args.keyword_artifact.read_text(encoding="utf-8"))
        if args.keyword_artifact
        else None
    )
    print(
        json.dumps(
            evaluate(
                queries,
                artifact,
                strategy=args.strategy,
                max_score=args.max_score,
                min_margin=args.min_margin,
                keyword_artifact=keyword_artifact,
                length_penalty=args.length_penalty,
            ),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

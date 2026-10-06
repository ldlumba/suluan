"""Score a saved query-vector/distance artifact without provider calls."""

from __future__ import annotations

import argparse
import json
import pathlib

from semantic_scoring import abstention_reason, score_records


def evaluate(queries, artifact, *, strategy, max_score, min_margin):
    by_id = {item["id"]: item for item in artifact.get("vectors", [])}
    rows = []
    for probe in queries:
        saved = by_id.get(probe["id"])
        if not saved:
            raise ValueError(f"missing saved vector for {probe['id']}")
        ranked = score_records(saved.get("chunkDistances", {}), strategy=strategy)
        reason = abstention_reason(
            ranked, max_score=max_score, min_margin=min_margin
        )
        title_to_id = {
            item.get("title"): item.get("id")
            for item in saved.get("rankedItems", [])
        }
        expected_id = title_to_id.get(probe.get("expectedTitle"))
        expected_rank = next(
            (rank for rank, item in enumerate(ranked, 1) if item.record_id == expected_id),
            None,
        )
        rows.append(
            {
                "id": probe["id"],
                "kind": probe["kind"],
                "abstention": reason,
                "topRecordId": ranked[0].record_id if ranked and not reason else None,
                "topScore": ranked[0].score if ranked else None,
                "expectedRank": expected_rank,
            }
        )
    positives = [row for row in rows if row["kind"] != "clean_negative"]
    negatives = [row for row in rows if row["kind"] == "clean_negative"]
    return {
        "strategy": strategy,
        "maxScore": max_score,
        "minMargin": min_margin,
        "positiveHitAt1": sum(row["expectedRank"] == 1 for row in positives)
        / len(positives)
        if positives
        else None,
        "negativeAbstention": sum(row["abstention"] is not None for row in negatives)
        / len(negatives)
        if negatives
        else None,
        "rows": rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("queries", type=pathlib.Path)
    parser.add_argument("artifact", type=pathlib.Path)
    parser.add_argument("--strategy", default="top_k_mean")
    parser.add_argument("--max-score", type=float, required=True)
    parser.add_argument("--min-margin", type=float)
    args = parser.parse_args()
    queries = json.loads(args.queries.read_text(encoding="utf-8"))
    artifact = json.loads(args.artifact.read_text(encoding="utf-8"))
    print(
        json.dumps(
            evaluate(
                queries,
                artifact,
                strategy=args.strategy,
                max_score=args.max_score,
                min_margin=args.min_margin,
            ),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

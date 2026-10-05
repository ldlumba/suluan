"""Run the labeled local semantic relevance evaluation without retrying calls."""

import argparse
import datetime
import getpass
import json
import math
import os
import pathlib
import statistics
import time
import urllib.error
import urllib.parse

from operator_client import OperatorWorkerClient

QUERY_FILE = pathlib.Path(__file__).with_name("semantic_relevance_queries.json")
DEFAULT_OUTPUT = pathlib.Path("logs/semantic-relevance.json")


class EvaluationError(RuntimeError):
    pass


def rank_of(items, title):
    for rank, item in enumerate(items, 1):
        if item["title"] == title:
            return rank
    return None


def safe_items(items):
    """Discard snippets so extracted text is never written to the result file."""
    return [
        {
            "id": item.get("id"),
            "title": item.get("title"),
            "visibility": item.get("visibility"),
            **(
                {"distance": float(item["distance"])}
                if item.get("distance") is not None
                else {}
            ),
        }
        for item in items
    ]


def rrf_titles(semantic, keyword, constant=60):
    scores = {}
    for items in (semantic, keyword):
        for rank, item in enumerate(items, 1):
            title = item["title"]
            scores[title] = scores.get(title, 0) + 1 / (constant + rank)
    return [title for title, _ in sorted(scores.items(), key=lambda row: (-row[1], row[0]))]


def mean(values):
    return statistics.mean(values) if values else None


def median(values):
    return statistics.median(values) if values else None


def pearson(xs, ys):
    if len(xs) < 2 or len(set(xs)) < 2 or len(set(ys)) < 2:
        return None
    x_mean, y_mean = statistics.mean(xs), statistics.mean(ys)
    numerator = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys))
    denominator = math.sqrt(
        sum((x - x_mean) ** 2 for x in xs) * sum((y - y_mean) ** 2 for y in ys)
    )
    return numerator / denominator if denominator else None


def ranking_metrics(rows, key):
    ranks = [row[key] for row in rows if row[key] is not None]
    total = len(rows)
    return {
        "queries": total,
        "hitAt1": sum(rank == 1 for rank in ranks) / total if total else None,
        "hitAt3": sum(rank <= 3 for rank in ranks) / total if total else None,
        "hitAt10": len(ranks) / total if total else None,
        "mrr": sum(1 / rank for rank in ranks) / total if total else None,
    }


def best_absolute_cutoff(positives, negatives):
    positive_distances = [
        row["expectedDistance"] if row["expectedDistance"] is not None else 2.0
        for row in positives
    ]
    negative_distances = [row["topDistance"] for row in negatives if row["topDistance"] is not None]
    candidates = sorted(set(positive_distances + negative_distances))
    best = None
    for cutoff in candidates:
        true_positive_rate = sum(value <= cutoff for value in positive_distances) / len(
            positive_distances
        )
        true_negative_rate = (
            sum(value > cutoff for value in negative_distances) / len(negative_distances)
            if negative_distances
            else 0
        )
        score = (true_positive_rate + true_negative_rate) / 2
        candidate = {
            "cutoff": cutoff,
            "balancedAccuracy": score,
            "positiveRecall": true_positive_rate,
            "negativeRejection": true_negative_rate,
        }
        if best is None or score > best["balancedAccuracy"]:
            best = candidate
    return best


def summarize(results):
    positives = [row for row in results if row["kind"] != "clean_negative"]
    negatives = [row for row in results if row["kind"] == "clean_negative"]
    top_counts = {}
    chunks = {}
    for row in results:
        if row["semantic"]:
            title = row["semantic"][0]["title"]
            top_counts[title] = top_counts.get(title, 0) + 1
        if row.get("expectedTitle") and row.get("expectedChunks"):
            chunks[row["expectedTitle"]] = row["expectedChunks"]
    labeled_titles = sorted(chunks)
    return {
        "semantic": ranking_metrics(positives, "semanticRank"),
        "keyword": ranking_metrics(positives, "keywordRank"),
        "hybridRrf": ranking_metrics(positives, "hybridRank"),
        "positiveExpectedDistance": {
            "mean": mean(
                [row["expectedDistance"] for row in positives if row["expectedDistance"] is not None]
            ),
            "median": median(
                [row["expectedDistance"] for row in positives if row["expectedDistance"] is not None]
            ),
        },
        "cleanNegativeTopDistance": {
            "mean": mean([row["topDistance"] for row in negatives if row["topDistance"] is not None]),
            "median": median(
                [row["topDistance"] for row in negatives if row["topDistance"] is not None]
            ),
        },
        "bestObservedAbsoluteCutoff": best_absolute_cutoff(positives, negatives),
        "topResultCountVsChunkCountPearson": pearson(
            [chunks[title] for title in labeled_titles],
            [top_counts.get(title, 0) for title in labeled_titles],
        ),
        "hardContrastWins": sum(
            row["semanticRank"] is not None
            and (
                row.get("contrastRank") is None
                or row["semanticRank"] < row["contrastRank"]
            )
            for row in positives
            if row["kind"] == "hard_positive"
        ),
        "hardContrastQueries": sum(row["kind"] == "hard_positive" for row in positives),
    }


def report_for(probes, results):
    return {
        "generatedAt": datetime.datetime.now(datetime.UTC).isoformat(),
        "probeCount": len(probes),
        "completedProbeCount": len(results),
        "complete": len(results) == len(probes),
        "summary": summarize(results),
        "results": results,
    }


def run_evaluation(
    client,
    probes,
    *,
    interval=3,
    sleep=time.sleep,
    emit=print,
    checkpoint=None,
):
    results = []
    for number, probe in enumerate(probes, 1):
        query = urllib.parse.urlencode({"q": probe["query"], "page": 1})
        semantic_response = client.json(f"/api/search/semantic?{query}")
        status = semantic_response.get("semanticStatus")
        if status != "ready":
            raise EvaluationError(
                f"probe {probe['id']} stopped with semanticStatus={status}"
            )
        semantic = safe_items(semantic_response.get("items", []))
        keyword = safe_items(client.json(f"/api/search/records?{query}").get("items", []))
        hybrid = rrf_titles(semantic, keyword)
        expected = probe.get("expectedTitle")
        semantic_rank = rank_of(semantic, expected) if expected else None
        keyword_rank = rank_of(keyword, expected) if expected else None
        hybrid_rank = hybrid.index(expected) + 1 if expected in hybrid else None
        contrast = probe.get("contrastTitle")
        expected_distance = (
            semantic[semantic_rank - 1].get("distance") if semantic_rank is not None else None
        )
        row = {
            **probe,
            "semanticRank": semantic_rank,
            "keywordRank": keyword_rank,
            "hybridRank": hybrid_rank,
            "contrastRank": rank_of(semantic, contrast) if contrast else None,
            "expectedDistance": expected_distance,
            "topDistance": semantic[0].get("distance") if semantic else None,
            "topMargin": (
                semantic[1]["distance"] - semantic[0]["distance"]
                if len(semantic) > 1
                else None
            ),
            "semantic": semantic,
            "keyword": keyword,
            "hybridTitles": hybrid,
        }
        results.append(row)
        if checkpoint:
            checkpoint(report_for(probes, results))
        label = (
            f"rank={semantic_rank}"
            if expected
            else f"top={semantic[0]['title'] if semantic else 'none'}"
        )
        emit(f"{number:02d}/{len(probes)} {probe['id']}: {label}")
        if number < len(probes):
            sleep(interval)
    return report_for(probes, results)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://localhost:8787")
    parser.add_argument("--queries", type=pathlib.Path, default=QUERY_FILE)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--interval", type=float, default=3)
    parser.add_argument(
        "--allow-remote",
        action="store_true",
        help="Explicitly allow sending the manager token to a validated HTTPS origin",
    )
    args = parser.parse_args()
    if args.interval < 1:
        parser.error("--interval must be at least 1 second")
    probes = json.loads(args.queries.read_text(encoding="utf-8"))
    if not 1 <= len(probes) <= 40:
        parser.error("the query set must contain between 1 and 40 probes")

    token = os.environ.get("SULUAN_ID_TOKEN") or getpass.getpass(
        "Manager Firebase ID token (hidden): "
    )
    client = OperatorWorkerClient(
        args.api,
        token,
        allow_remote=args.allow_remote,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)

    def save(report):
        args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")

    save(report_for(probes, []))
    try:
        report = run_evaluation(
            client,
            probes,
            interval=args.interval,
            checkpoint=save,
        )
    except EvaluationError as error:
        raise SystemExit(f"{error}; completed results remain in {args.output}") from None
    except urllib.error.HTTPError as error:
        raise SystemExit(
            f"Worker returned HTTP {error.code}; no retry was attempted; "
            f"completed results remain in {args.output}"
        ) from None
    except urllib.error.URLError:
        raise SystemExit(
            f"Worker unavailable; no retry was attempted; completed results remain in {args.output}"
        ) from None

    save(report)
    print(json.dumps(report["summary"], indent=2))
    print(f"sanitized results written to {args.output}")


if __name__ == "__main__":
    main()

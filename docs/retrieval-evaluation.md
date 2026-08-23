# Context retrieval evaluation

BRG-130 adds a dependency-free, offline relevance benchmark for deciding whether Bridge should add vector retrieval. It does not change the canonical REST context query, its authority rules, PostgreSQL storage, MCP behavior, or human approval policy.

## Run the benchmark

```bash
pnpm retrieval:evaluate:test
pnpm retrieval:evaluate
```

Both commands are deterministic and read-only. They make no network or database connection and write no report file. `pnpm check` runs the tests and compact evaluation so a dataset or ranking change must keep the evidence executable.

The default dataset is [`../config/context-retrieval-evaluation.json`](../config/context-retrieval-evaluation.json). A different local dataset with the same schema can be evaluated with:

```bash
pnpm retrieval:evaluate -- --dataset /absolute/path/to/dataset.json
```

Do not commit customer records, prompts, transcripts, credentials, repository source, or private relevance judgments. The checked-in corpus is synthetic Bridge-style content.

## Compared rankers

The benchmark compares two candidates after applying the same category eligibility, record-authority weight, and exact-scope boosts:

1. `current_weighted_lexical_proxy` mirrors the application ranker's deterministic unique-token overlap over record text. It is a repository-side proxy, not a query against live PostgreSQL.
2. `hashed_sparse_tfidf_vector` builds a deterministic 1,024-dimension sparse TF-IDF vector from the same text and uses cosine similarity. It requires no model, external service, extension, or persistent index.

Each curated query identifies every relevant record. The report calculates mean Recall@5, mean reciprocal rank, and normalized discounted cumulative gain at five, plus per-query top-five results. The adoption rule was declared in the dataset before interpreting the result: the candidate must reach at least `0.85` Recall@5 and improve Recall@5 by at least `0.10` over the baseline.

## 2026-08-24 result

| Ranker | Recall@5 | MRR | nDCG@5 |
|---|---:|---:|---:|
| Weighted lexical proxy | 1.0000 | 1.0000 | 0.9773 |
| Sparse TF-IDF vector | 1.0000 | 1.0000 | 0.9875 |

The candidate's Recall@5 gain is `0.0000`, below the `0.10` material-gain threshold. Its small nDCG@5 improvement does not satisfy the declared recall rule. The current verdict is `do_not_adopt_vector_candidate`: retain deterministic retrieval and do not add pgvector, an embedding provider, or a vector database based on this evidence.

This verdict is intentionally narrow. Twenty synthetic records and twelve curated queries do not establish production retrieval quality, dense-embedding quality, latency, cost, multilingual behavior, or tenant-index operations. Reopen the decision after collecting a privacy-reviewed, labeled pilot dataset with demonstrable lexical recall failures. Any future derived index must remain tenant-scoped, rebuildable from canonical records, and subordinate to lifecycle, authority, explicit-link, and exact-scope rules.

## Extending the evidence

- Version the dataset date whenever records, queries, labels, thresholds, or `k` change.
- Keep relevance labels independent from ranker output and require at least one known relevant record per query.
- Add difficult paraphrase, vocabulary-mismatch, category, work-item, and same-topic/different-scope cases before evaluating dense embeddings.
- Record model/version, normalization, dimensions, latency, and cost when a real embedding candidate is tested.
- Treat ranking output as advisory context selection only. Retrieval never accepts a decision or approves a specification.

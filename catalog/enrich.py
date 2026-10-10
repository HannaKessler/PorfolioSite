"""Add sale prices and Elasticsearch similar-product ids, then write the catalog file."""

import json
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ES = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:9200"
OUT = Path(__file__).resolve().parents[1] / "src" / "data" / "catalog.json"
MLT_FIELDS = ["title", "description", "brand", "categoryName", "tags", "searchText"]


def request(method, url, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=60) as response:
        return json.load(response)


def sale_price(price, discount):
    return round(float(price) * (1 - float(discount) / 100), 2)


def search_text(product):
    reviews = product.get("reviews") or []
    comments = [review.get("comment") or "" for review in reviews]
    tags = product.get("tags") or []
    parts = [
        product.get("title") or "",
        product.get("description") or "",
        product.get("brand") or "",
        product.get("categoryName") or "",
        " ".join(tags),
        " ".join(comments),
    ]
    return "\n".join(part for part in parts if part)


def main():
    info = request("GET", ES)
    found = request(
        "POST",
        f"{ES}/products/_search",
        {"size": 250, "query": {"match_all": {}}},
    )
    hits = found["hits"]["hits"]
    if len(hits) < 100:
        raise SystemExit(f"expected the full catalog, found {len(hits)} documents")

    updates = []
    products = []
    for hit in hits:
        product = hit["_source"]
        product["salePrice"] = sale_price(
            product.get("price") or 0,
            product.get("discountPercentage") or 0,
        )
        product["searchText"] = search_text(product)
        products.append(product)
        updates.append(json.dumps({"update": {"_id": str(product["id"])}}))
        updates.append(json.dumps({"doc": {
            "salePrice": product["salePrice"],
            "searchText": product["searchText"],
        }}))

    bulk = ("\n".join(updates) + "\n").encode()
    bulk_req = urllib.request.Request(
        f"{ES}/products/_bulk",
        data=bulk,
        method="POST",
        headers={"Content-Type": "application/x-ndjson"},
    )
    try:
        with urllib.request.urlopen(bulk_req, timeout=60) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise SystemExit(error.read().decode()[:2000]) from error
    if result.get("errors"):
        raise SystemExit("updating search text failed")
    request("POST", f"{ES}/products/_refresh")

    by_category = defaultdict(list)
    for product in products:
        by_category[product.get("category") or ""].append(product)

    themes = []
    for slug, group in by_category.items():
        if not slug:
            continue
        average = sum(float(item.get("rating") or 0) for item in group) / len(group)
        themes.append({
            "slug": slug,
            "name": group[0].get("categoryName") or slug,
            "averageRating": round(average, 2),
            "count": len(group),
        })
    themes.sort(key=lambda theme: (-theme["averageRating"], -theme["count"], theme["slug"]))
    popular = [{k: theme[k] for k in ("slug", "name", "averageRating")} for theme in themes[:5]]
    if len(popular) < 5:
        raise SystemExit("fewer than 5 categories were available for the popular rows")

    neighbor_count = 0
    exported = []
    for product in products:
        product_id = str(product["id"])
        likes = request("POST", f"{ES}/products/_search", {
            "size": 12,
            "_source": False,
            "query": {
                "more_like_this": {
                    "fields": MLT_FIELDS,
                    "like": [{"_index": "products", "_id": product_id}],
                    "min_term_freq": 1,
                    "min_doc_freq": 1,
                    "max_query_terms": 25,
                    "minimum_should_match": "20%",
                }
            },
        })
        similar_ids = []
        for hit in likes["hits"]["hits"]:
            if hit["_id"] == product_id:
                continue
            similar_ids.append(int(hit["_id"]))
        neighbor_count += len(similar_ids)
        public = {key: value for key, value in product.items() if key != "searchText"}
        meta = public.get("meta")
        if isinstance(meta, dict):
            meta.pop("qrCode", None)
        public["similarIds"] = similar_ids
        exported.append(public)

    if neighbor_count == 0:
        raise SystemExit("Elasticsearch returned no similar products")

    exported.sort(key=lambda product: product["id"])
    catalog = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "https://dummyjson.com/products",
        "elasticsearchVersion": info["version"]["number"],
        "popularThemes": popular,
        "products": exported,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(exported)} products to {OUT}")
    print(f"elasticsearch {catalog['elasticsearchVersion']}")
    print("popular:", ", ".join(theme["name"] for theme in popular))


if __name__ == "__main__":
    main()

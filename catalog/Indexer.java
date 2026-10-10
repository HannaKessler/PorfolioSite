import org.json.JSONArray;
import org.json.JSONObject;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/** Loads the DummyJSON catalog into a local Elasticsearch index. */
public class Indexer {
    public static void main(String[] args) throws Exception {
        String es = args.length > 0 ? args[0] : "http://127.0.0.1:9200";
        if (es.endsWith("/")) {
            es = es.substring(0, es.length() - 1);
        }

        HttpClient http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(30))
                .build();

        JSONObject categoryNames = new JSONObject();
        JSONArray categories = new JSONArray(get(http, "https://dummyjson.com/products/categories"));
        for (int i = 0; i < categories.length(); i++) {
            JSONObject category = categories.getJSONObject(i);
            categoryNames.put(category.getString("slug"), category.getString("name"));
        }

        List<JSONObject> products = new ArrayList<>();
        int skip = 0;
        int total = Integer.MAX_VALUE;
        while (skip < total) {
            String body = get(http, "https://dummyjson.com/products?limit=50&skip=" + skip);
            JSONObject page = new JSONObject(body);
            total = page.getInt("total");
            JSONArray batch = page.getJSONArray("products");
            if (batch.isEmpty()) {
                break;
            }
            for (int i = 0; i < batch.length(); i++) {
                JSONObject product = batch.getJSONObject(i);
                String slug = product.optString("category", "");
                product.put("categoryName", categoryNames.optString(slug, slug));
                if (product.isNull("brand")) {
                    product.put("brand", "");
                }
                products.add(product);
            }
            skip += batch.length();
        }

        if (products.isEmpty()) {
            throw new IllegalStateException("DummyJSON returned no products");
        }

        int deleted = request(http, "DELETE", es + "/products", null);
        if (deleted != 200 && deleted != 404) {
            throw new IllegalStateException("Could not reset the products index (" + deleted + ")");
        }

        String mapping = """
                {
                  "settings": { "number_of_shards": 1, "number_of_replicas": 0 },
                  "mappings": {
                    "properties": {
                      "title": { "type": "text" },
                      "description": { "type": "text" },
                      "brand": { "type": "text" },
                      "category": { "type": "keyword" },
                      "categoryName": { "type": "keyword" },
                      "tags": { "type": "keyword" },
                      "searchText": { "type": "text" },
                      "rating": { "type": "float" }
                    }
                  }
                }
                """;
        int created = request(http, "PUT", es + "/products", mapping);
        if (created >= 300) {
            throw new IllegalStateException("Could not create the products index (" + created + ")");
        }

        StringBuilder bulk = new StringBuilder();
        int pending = 0;
        for (JSONObject product : products) {
            bulk.append("{\"index\":{\"_id\":\"")
                    .append(product.getInt("id"))
                    .append("\"}}\n");
            bulk.append(product).append('\n');
            pending++;
            if (pending == 40) {
                flushBulk(http, es, bulk);
                bulk.setLength(0);
                pending = 0;
            }
        }
        if (pending > 0) {
            flushBulk(http, es, bulk);
        }

        request(http, "POST", es + "/products/_refresh", null);
        System.out.println("indexed " + products.size() + " products");
    }

    private static void flushBulk(HttpClient http, String es, StringBuilder bulk) throws Exception {
        HttpResponse<String> response = send(http, "POST", es + "/products/_bulk", bulk.toString());
        if (response.statusCode() >= 300 || response.body().contains("\"errors\":true")) {
            throw new IllegalStateException("Bulk index failed: " + response.body());
        }
    }

    private static String get(HttpClient http, String url) throws Exception {
        HttpResponse<String> response = send(http, "GET", url, null);
        if (response.statusCode() >= 300) {
            throw new IllegalStateException(url + " returned " + response.statusCode());
        }
        return response.body();
    }

    private static int request(HttpClient http, String method, String url, String body) throws Exception {
        return send(http, method, url, body).statusCode();
    }

    private static HttpResponse<String> send(HttpClient http, String method, String url, String body)
            throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(60));
        if (body == null) {
            builder.method(method, HttpRequest.BodyPublishers.noBody());
        } else {
            builder.header("Content-Type", "application/json");
            builder.method(method, HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8));
        }
        return http.send(builder.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }
}
